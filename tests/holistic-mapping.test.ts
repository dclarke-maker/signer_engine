import { describe, expect, it } from "vitest";

import { holisticToFrame, type HolisticResultLike } from "../lib/extractors/holistic-mapping";
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
} from "../shared/landmarks";

const pts = (n: number, tag: number) =>
  Array.from({ length: n }, (_, i) => ({ x: tag, y: i / n, z: 0, visibility: 1 }));

const full = (): HolisticResultLike => ({
  faceLandmarks: [pts(FACE_LANDMARK_COUNT, 1)],
  poseLandmarks: [pts(POSE_LANDMARK_COUNT, 2)],
  leftHandLandmarks: [pts(HAND_LANDMARK_COUNT, 3)],
  rightHandLandmarks: [pts(HAND_LANDMARK_COUNT, 4)],
});

describe("holistic result mapping", () => {
  it("maps every stream at its expected size", () => {
    const frame = holisticToFrame(full(), 123, { mirrored: false });
    expect(frame.t).toBe(123);
    expect(frame.face).toHaveLength(FACE_LANDMARK_COUNT);
    expect(frame.pose).toHaveLength(POSE_LANDMARK_COUNT);
    expect(frame.leftHand).toHaveLength(HAND_LANDMARK_COUNT);
    expect(frame.rightHand).toHaveLength(HAND_LANDMARK_COUNT);
  });

  it("swaps hands for a mirrored front camera so left means the signer's left", () => {
    const plain = holisticToFrame(full(), 0, { mirrored: false });
    const mirrored = holisticToFrame(full(), 0, { mirrored: true });
    // tag 3 is what MediaPipe called "left"; mirrored, it is the signer's right.
    expect(plain.leftHand![0].x).toBe(3);
    expect(mirrored.leftHand![0].x).toBe(4);
    expect(mirrored.rightHand![0].x).toBe(3);
  });

  it("returns null for an undetected stream rather than an empty array", () => {
    const frame = holisticToFrame(
      { ...full(), leftHandLandmarks: [], faceLandmarks: [] },
      0,
      { mirrored: false },
    );
    expect(frame.leftHand).toBeNull();
    expect(frame.face).toBeNull();
    expect(frame.pose).not.toBeNull();
  });

  it("rejects a wrong-sized stream instead of passing a partial array through", () => {
    // A short face array would make the NMM rules read the wrong landmark
    // indices and silently produce wrong linguistics.
    const frame = holisticToFrame(
      { ...full(), faceLandmarks: [pts(468 - 10, 1)], poseLandmarks: [pts(20, 2)] },
      0,
      { mirrored: false },
    );
    expect(frame.face).toBeNull();
    expect(frame.pose).toBeNull();
  });

  it("preserves coordinates and visibility verbatim", () => {
    const frame = holisticToFrame(full(), 0, { mirrored: false });
    expect(frame.pose![5]).toEqual({ x: 2, y: 5 / POSE_LANDMARK_COUNT, z: 0, visibility: 1 });
  });

  it("omits visibility when MediaPipe does not supply it", () => {
    const noVis: HolisticResultLike = {
      ...full(),
      poseLandmarks: [
        Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 })),
      ],
    };
    expect(holisticToFrame(noVis, 0, { mirrored: false }).pose![0]).toEqual({ x: 0, y: 0, z: 0 });
  });
});
