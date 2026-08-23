import { describe, expect, it } from "vitest";

import { encodeHolisticBase64 } from "../lib/extractors/holistic-buffer";
import { createMediaPipeNativeExtractor } from "../lib/extractors/mediapipe-native-extractor";
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
} from "../shared/landmarks";

const pts = (n: number): Landmark[] =>
  Array.from({ length: n }, (_, i) => ({ x: i / n, y: i / n, z: 0, visibility: 1 }));

/** A complete frame stamped at `t`, in the form the native plugins send. */
const packedAt = (t: number) =>
  encodeHolisticBase64({
    t,
    face: pts(FACE_LANDMARK_COUNT),
    pose: pts(POSE_LANDMARK_COUNT),
    leftHand: pts(HAND_LANDMARK_COUNT),
    rightHand: pts(HAND_LANDMARK_COUNT),
  });

describe("native holistic extractor", () => {
  it("measures each capture from its own first frame", async () => {
    // The plugin outlives a capture, so its clock does not start at zero when
    // the second prompt begins. An un-normalised offset would report a
    // multi-hour duration for a five second capture.
    const extractor = createMediaPipeNativeExtractor();
    const seen: LandmarkFrame[] = [];

    await extractor.start({ targetFps: 25 });
    extractor.subscribe((f) => seen.push(f));
    for (const t of [900_000, 900_040, 900_080]) extractor.acceptPackedFrame(packedAt(t));
    const summary = await extractor.stop();

    expect(seen.map((f) => f.t)).toEqual([0, 40, 80]);
    expect(summary.durationMs).toBe(80);
  });

  it("resets the origin between captures", async () => {
    const extractor = createMediaPipeNativeExtractor();

    await extractor.start({ targetFps: 25 });
    extractor.acceptPackedFrame(packedAt(1_000));
    extractor.acceptPackedFrame(packedAt(1_040));
    await extractor.stop();

    const seen: LandmarkFrame[] = [];
    await extractor.start({ targetFps: 25 });
    extractor.subscribe((f) => seen.push(f));
    extractor.acceptPackedFrame(packedAt(50_000));
    extractor.acceptPackedFrame(packedAt(50_040));
    const summary = await extractor.stop();

    expect(seen.map((f) => f.t)).toEqual([0, 40]);
    expect(summary.durationMs).toBe(40);
  });

  it("reports the rate over the gaps between frames, not the frame count", async () => {
    // Three frames 40ms apart span two intervals, so the rate is 25fps.
    // Dividing frameCount by the span would call it 37.5.
    const extractor = createMediaPipeNativeExtractor();

    await extractor.start({ targetFps: 25 });
    for (const t of [0, 40, 80]) extractor.acceptPackedFrame(packedAt(t));
    const summary = await extractor.stop();

    expect(summary.frameCount).toBe(3);
    expect(summary.achievedFps).toBeCloseTo(25, 5);
  });

  it("reports no rate for a capture too short to have one", async () => {
    const extractor = createMediaPipeNativeExtractor();
    await extractor.start({ targetFps: 25 });
    extractor.acceptPackedFrame(packedAt(7_000));
    const summary = await extractor.stop();

    expect(summary.frameCount).toBe(1);
    expect(summary.achievedFps).toBe(0);
    expect(summary.durationMs).toBe(0);
  });

  it("drops and counts a malformed frame instead of failing the capture", async () => {
    const extractor = createMediaPipeNativeExtractor();
    const seen: LandmarkFrame[] = [];

    await extractor.start({ targetFps: 25 });
    extractor.subscribe((f) => seen.push(f));
    extractor.acceptPackedFrame(packedAt(0));
    extractor.acceptPackedFrame("this is not base64!");
    extractor.acceptPackedFrame(packedAt(40));
    const summary = await extractor.stop();

    expect(seen).toHaveLength(2);
    expect(extractor.decodeFailures).toBe(1);
    expect(summary.frameCount).toBe(2);
    expect(summary.coverage.face).toBe(1);
  });

  it("ignores frames that arrive after the capture stops", async () => {
    const extractor = createMediaPipeNativeExtractor();
    await extractor.start({ targetFps: 25 });
    extractor.acceptPackedFrame(packedAt(0));
    const summary = await extractor.stop();

    // The camera thread does not stop the instant JS does.
    extractor.acceptPackedFrame(packedAt(40));
    expect(summary.frameCount).toBe(1);
    expect(extractor.isRunning).toBe(false);
  });
});
