import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
} from "../../shared/landmarks";

/** Deterministic, non-random landmark filler. */
export function makeLandmarks(count: number, seed = 0): Landmark[] {
  return Array.from({ length: count }, (_, i) => ({
    x: ((i * 7 + seed) % 100) / 100,
    y: ((i * 13 + seed) % 100) / 100,
    z: ((i * 3 + seed) % 50) / 100,
    visibility: 1,
  }));
}

export function makeFrame(overrides: Partial<LandmarkFrame> = {}): LandmarkFrame {
  return {
    t: 0,
    leftHand: makeLandmarks(HAND_LANDMARK_COUNT, 1),
    rightHand: makeLandmarks(HAND_LANDMARK_COUNT, 2),
    face: makeLandmarks(FACE_LANDMARK_COUNT, 3),
    pose: makeLandmarks(POSE_LANDMARK_COUNT, 4),
    ...overrides,
  };
}

export function makeSequence(options: {
  frameCount: number;
  fps?: number;
  mutate?: (frame: LandmarkFrame, index: number) => LandmarkFrame;
}): LandmarkFrame[] {
  const fps = options.fps ?? 30;
  const step = 1000 / fps;
  return Array.from({ length: options.frameCount }, (_, i) => {
    const base = makeFrame({ t: Math.round(i * step) });
    return options.mutate ? options.mutate(base, i) : base;
  });
}
