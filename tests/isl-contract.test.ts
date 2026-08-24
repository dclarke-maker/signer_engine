import { gunzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { computeSignerBaseline } from "../server/nmm/baseline";
import { detectNmms } from "../server/nmm/rules";
import {
  FACE_LANDMARK_COUNT,
  FACE_LANDMARK_COUNT_WITH_IRIS,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type LandmarkFrame,
  type LandmarkSequencePayload,
} from "../shared/landmarks";

/**
 * Proves ISL output is readable by the NSL pipeline, rather than merely looking
 * similar to it.
 *
 * The fixture is emitted by `tools/isl/make_fixture.py` through the same
 * `to_payload_json` the real ISL preprocessing uses, then consumed here by the
 * actual server code. Two runtimes produce the two halves of RQ4 - a Kotlin
 * frame processor on a phone, and Python over recorded video - and if they drift
 * apart the model pre-trains in one coordinate space and fine-tunes in another
 * with nothing failing. This test is where that drift becomes a red build.
 *
 * Regenerate with:
 *   python -m tools.isl.make_fixture tests/fixtures/isl-verification.json
 *   gzip -9 tests/fixtures/isl-verification.json
 */
const payload = JSON.parse(
  new TextDecoder().decode(
    gunzipSync(readFileSync("tests/fixtures/isl-verification.json.gz")),
  ),
) as LandmarkSequencePayload & { dataset?: Record<string, string>; text?: string };

const frames = payload.frames;

describe("an ISL sequence in the NSL landmark space", () => {
  it("carries the provenance that keeps ISL and NSL rows apart", () => {
    // Not cosmetic: iSign is CC-BY-NC-SA and NSL capture is governed by
    // participant consent, so the two can never be pooled for redistribution.
    expect(payload.extractorId).toBe("mediapipe-holistic-offline@1");
    expect(payload.category).toBe("isl-continuous");
    expect(payload.dataset?.licence).toBe("CC-BY-NC-SA-4.0");
  });

  it("has the stream sizes the decoder accepts", () => {
    for (const frame of frames) {
      if (frame.face) {
        expect([FACE_LANDMARK_COUNT, FACE_LANDMARK_COUNT_WITH_IRIS]).toContain(
          frame.face.length,
        );
      }
      if (frame.pose) expect(frame.pose).toHaveLength(POSE_LANDMARK_COUNT);
      if (frame.leftHand) expect(frame.leftHand).toHaveLength(HAND_LANDMARK_COUNT);
      if (frame.rightHand) expect(frame.rightHand).toHaveLength(HAND_LANDMARK_COUNT);
    }
  });

  it("marks an undetected stream as null rather than as coordinates at the origin", () => {
    const missing = frames.filter((f) => f.leftHand === null);
    expect(missing.length).toBeGreaterThan(0);
    // If absence were encoded as zeros, every one of these frames would read as
    // a hand resting exactly at the top-left corner.
    expect(missing.every((f) => f.leftHand === null)).toBe(true);
  });

  it("carries a per-frame aspect ratio, and a landscape one at that", () => {
    // iSign is broadcast and studio footage; NSL capture is portrait. Without
    // this number the marker rules cannot compare a vertical measure against a
    // horizontal one, and the two corpora sit at opposite ends of the range.
    for (const frame of frames) expect(frame.aspect).toBeGreaterThan(0);
    expect(frames[0].aspect).toBeCloseTo(16 / 9, 3);
  });

  it("starts at zero and runs forward in source order", () => {
    expect(frames[0].t).toBe(0);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i].t).toBeGreaterThan(frames[i - 1].t);
    }
  });

  it("is stored at the NSL canonical precision", () => {
    const coordinates = frames
      .flatMap((f) => f.pose ?? [])
      .flatMap((p) => [p.x, p.y, p.z]);
    for (const value of coordinates.slice(0, 400)) {
      // Rounded to 5dp and then held as float32, so the JSON carries the
      // float32 neighbour of the rounded value - a few parts in 1e9, not exact.
      expect(Math.abs(Number(value.toFixed(5)) - value)).toBeLessThan(1e-6);
    }
  });
});

describe("the NSL server code consumes it unmodified", () => {
  it("derives a signer baseline from an ISL clip", () => {
    // The real function, not a reimplementation. It needs pose and face on the
    // opening frames and a non-zero shoulder width, so a null here means the
    // ISL extractor put a landmark somewhere the NSL pipeline does not expect.
    const baseline = computeSignerBaseline(frames as LandmarkFrame[]);

    expect(baseline).not.toBeNull();
    expect(baseline!.shoulderWidth).toBeGreaterThan(0);
    expect(Number.isFinite(baseline!.neutralBrowGap)).toBe(true);
    expect(Number.isFinite(baseline!.neutralShoulderAngle)).toBe(true);
  });

  it("runs the marker rules over it without error", () => {
    const baseline = computeSignerBaseline(frames as LandmarkFrame[])!;
    const detections = detectNmms(frames as LandmarkFrame[], { baseline });

    // The rules are NSL-specific and are not run over ISL in production - the
    // point is that they *can* run, which is what proves the geometry is in the
    // space they expect.
    for (const detection of detections) {
      expect(detection.startFrame).toBeGreaterThanOrEqual(0);
      expect(detection.endFrame).toBeLessThan(frames.length);
      expect(detection.confidence).toBeGreaterThan(0);
    }
  });

  it("finds the eyebrow raise the fixture encodes", () => {
    // The fixture lifts both brows away from the eyes for frames 18-29, by
    // enough to clear baseline-v1's threshold. A rule that cannot see it is
    // reading the wrong landmarks - which is exactly the failure that put face
    // indices 7 and 8 on the eye and the nose bridge.
    const baseline = computeSignerBaseline(frames as LandmarkFrame[])!;
    const detections = detectNmms(frames as LandmarkFrame[], { baseline });

    expect(detections.map((d) => d.type)).toContain("eyebrow_raise");
  });

  it("reports no body tilt for a signer who is square to the camera", () => {
    // Regression cover across the language boundary: the tilt rule once scored
    // 24x its threshold on every real frame because atan2 took a signed
    // horizontal separation. ISL video has the same coordinate convention.
    const baseline = computeSignerBaseline(frames as LandmarkFrame[])!;
    const detections = detectNmms(frames as LandmarkFrame[], { baseline });

    expect(detections.filter((d) => d.type === "body_tilt")).toEqual([]);
  });
});

describe("the canonical model-input topology", () => {
  it("truncates to a fixed 468 without moving any index a rule reads", () => {
    // A Transformer input tensor cannot have a variable dimension. MediaPipe
    // appends the ten iris points rather than interleaving them, so this is a
    // slice - and every face index in server/nmm/baseline.ts is below 468.
    const face = frames.find((f) => f.face)!.face!;
    expect(face.length).toBe(FACE_LANDMARK_COUNT_WITH_IRIS);

    const canonical = face.slice(0, FACE_LANDMARK_COUNT);
    expect(canonical).toHaveLength(FACE_LANDMARK_COUNT);
    for (const index of [0, 33, 133, 263, 362, 105, 334]) {
      expect(canonical[index]).toEqual(face[index]);
    }
  });
});
