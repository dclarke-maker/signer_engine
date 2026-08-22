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

/**
 * Anatomically plausible landmark layout. `makeLandmarks` fills every point with
 * arbitrary values, which is fine as inert padding but produces nonsense geometry
 * for the landmarks the NMM rules actually read - a baseline derived from it is
 * meaningless and every rule fires at once. Use this whenever a test touches
 * baseline computation or detection.
 */
export function makePoseFrame(
  t: number,
  o: {
    shoulderL?: [number, number, number];
    shoulderR?: [number, number, number];
    hipL?: [number, number, number];
    hipR?: [number, number, number];
    nose?: [number, number, number];
    earL?: [number, number, number];
    earR?: [number, number, number];
    browL?: [number, number, number];
    browR?: [number, number, number];
    eyeL?: [number, number, number];
    eyeR?: [number, number, number];
  } = {},
): LandmarkFrame {
  const base = makeFrame({ t });
  const pose = [...base.pose!];
  const face = [...base.face!];
  const set = (arr: Landmark[], i: number, v?: [number, number, number]) => {
    if (v) arr[i] = { x: v[0], y: v[1], z: v[2], visibility: 1 };
  };

  set(pose, 11, o.shoulderL ?? [0.4, 0.5, 0]);
  set(pose, 12, o.shoulderR ?? [0.6, 0.5, 0]);
  set(pose, 23, o.hipL ?? [0.42, 0.8, 0]);
  set(pose, 24, o.hipR ?? [0.58, 0.8, 0]);
  set(face, 0, o.nose ?? [0.5, 0.35, 0]);
  set(face, 7, o.earL ?? [0.42, 0.32, 0]);
  set(face, 8, o.earR ?? [0.58, 0.32, 0]);
  set(face, 33, o.eyeL ?? [0.45, 0.33, 0]);
  set(face, 133, o.eyeR ?? [0.55, 0.33, 0]);
  set(face, 105, o.browL ?? [0.45, 0.3, 0]);
  set(face, 334, o.browR ?? [0.55, 0.3, 0]);

  return { ...base, t, pose, face };
}

/** A run of neutral, anatomically plausible frames at 30fps. */
export function makeNeutralSequence(frameCount: number): LandmarkFrame[] {
  return Array.from({ length: frameCount }, (_, i) => makePoseFrame(Math.round(i * (1000 / 30))));
}
