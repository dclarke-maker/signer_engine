import { gunzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { encodeSequenceBody } from "../lib/sequence-payload";
import { MAX_SEQUENCE_BYTES } from "../server/sequence-upload";
import {
  FACE_LANDMARK_COUNT_WITH_IRIS,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
  type LandmarkSequencePayload,
} from "../shared/landmarks";

/**
 * Landmarks with the digits MediaPipe actually emits. Rounded fixtures would
 * make this test pass for the wrong reason - the size problem was precisely
 * that a float64 coordinate serialises as `0.6392536163330078`.
 */
const points = (n: number, seed: number): Landmark[] =>
  Array.from({ length: n }, (_, i) => ({
    x: Math.sin(seed + i) * 0.5 + 0.5,
    y: Math.cos(seed + i) * 0.5 + 0.5,
    z: Math.sin(seed * i) * 0.3,
    visibility: 0.9998576641082764,
  }));

/** A sentence of the length and rate the design targets, with a face detected. */
function realisticCapture(seconds: number, fps: number): LandmarkSequencePayload {
  const frameCount = seconds * fps;
  const frames: LandmarkFrame[] = Array.from({ length: frameCount }, (_, i) => ({
    t: Math.round((i * 1000) / fps),
    aspect: 0.75,
    face: points(FACE_LANDMARK_COUNT_WITH_IRIS, i),
    pose: points(POSE_LANDMARK_COUNT, i + 1),
    leftHand: points(HAND_LANDMARK_COUNT, i + 2),
    rightHand: points(HAND_LANDMARK_COUNT, i + 3),
  }));

  return {
    schemaVersion: 1,
    sessionId: "s",
    promptId: "A-01",
    category: "declarative",
    extractorId: "mediapipe-holistic-native@1",
    targetFps: fps,
    achievedFps: fps,
    frameCount,
    durationMs: seconds * 1000,
    frames,
  };
}

describe("upload payload size", () => {
  it("keeps a full-length sentence well inside the server's limit", () => {
    // Uncompressed and unrounded this is about 24 MB, which is over
    // MAX_SEQUENCE_BYTES - the first real sentence of collection failed to
    // upload at all. The margin here is what makes the pipeline usable.
    const body = encodeSequenceBody(realisticCapture(15, 30));

    expect(body.byteLength).toBeLessThan(MAX_SEQUENCE_BYTES / 4);
  });

  it("survives a capture far longer than any prompt", () => {
    const body = encodeSequenceBody(realisticCapture(60, 30));
    expect(body.byteLength).toBeLessThan(MAX_SEQUENCE_BYTES);
  });

  it("round-trips to the same landmarks the server will read", () => {
    const payload = realisticCapture(1, 2);
    const decoded = JSON.parse(
      new TextDecoder().decode(gunzipSync(encodeSequenceBody(payload))),
    ) as LandmarkSequencePayload;

    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames[0].face).toHaveLength(FACE_LANDMARK_COUNT_WITH_IRIS);
    expect(decoded.frames[0].aspect).toBe(0.75);
    expect(decoded.frameCount).toBe(payload.frameCount);
  });

  it("keeps coordinates accurate to well under a pixel", () => {
    const payload = realisticCapture(1, 1);
    const decoded = JSON.parse(
      new TextDecoder().decode(gunzipSync(encodeSequenceBody(payload))),
    ) as LandmarkSequencePayload;

    const before = payload.frames[0].pose!;
    const after = decoded.frames[0].pose!;
    for (let i = 0; i < before.length; i += 1) {
      // 1e-5 of a 1080px frame is about a hundredth of a pixel.
      expect(Math.abs(after[i].x - before[i].x)).toBeLessThan(1e-5);
      expect(Math.abs(after[i].y - before[i].y)).toBeLessThan(1e-5);
    }
  });

  it("does not invent a visibility score where the model gave none", () => {
    const payload = realisticCapture(1, 1);
    payload.frames[0].pose = payload.frames[0].pose!.map(({ x, y, z }) => ({ x, y, z }));

    const decoded = JSON.parse(
      new TextDecoder().decode(gunzipSync(encodeSequenceBody(payload))),
    ) as LandmarkSequencePayload;

    expect(decoded.frames[0].pose![0].visibility).toBeUndefined();
  });
});
