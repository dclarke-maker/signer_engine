import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
} from "@/shared/landmarks";

/**
 * Anatomically plausible stand-in frames so the screens have something real to
 * render before the native extractor exists. Neutral posture throughout, then a
 * sustained shoulder tilt, so the review screen shows a genuine marker rather
 * than an empty list.
 */
function filler(count: number, seed: number): Landmark[] {
  return Array.from({ length: count }, (_, i) => ({
    x: ((i * 7 + seed) % 100) / 100,
    y: ((i * 13 + seed) % 100) / 100,
    z: ((i * 3 + seed) % 50) / 100,
    visibility: 1,
  }));
}

function frameAt(index: number, tilted: boolean): LandmarkFrame {
  const pose = filler(POSE_LANDMARK_COUNT, 4);
  const face = filler(FACE_LANDMARK_COUNT, 3);
  const set = (arr: Landmark[], i: number, x: number, y: number, z = 0) => {
    arr[i] = { x, y, z, visibility: 1 };
  };

  set(pose, 11, 0.4, tilted ? 0.44 : 0.5);
  set(pose, 12, 0.6, tilted ? 0.56 : 0.5);
  set(pose, 23, 0.42, 0.8);
  set(pose, 24, 0.58, 0.8);
  set(face, 0, 0.5, 0.35);
  set(face, 7, 0.42, 0.32);
  set(face, 8, 0.58, 0.32);
  set(face, 33, 0.45, 0.33);
  set(face, 133, 0.55, 0.33);
  set(face, 105, 0.45, 0.3);
  set(face, 334, 0.55, 0.3);

  return {
    t: Math.round(index * (1000 / 30)),
    leftHand: filler(HAND_LANDMARK_COUNT, 1),
    rightHand: filler(HAND_LANDMARK_COUNT, 2),
    face,
    pose,
  };
}

export const demoSequence: LandmarkFrame[] = Array.from({ length: 90 }, (_, i) =>
  frameAt(i, i >= 45),
);
