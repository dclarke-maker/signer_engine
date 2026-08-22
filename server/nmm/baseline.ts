import type { Landmark, LandmarkFrame } from "../../shared/landmarks";

/** Pose indices, per design.md §5.2. */
export const POSE_SHOULDER_LEFT = 11;
export const POSE_SHOULDER_RIGHT = 12;
export const POSE_HIP_LEFT = 23;
export const POSE_HIP_RIGHT = 24;

/** Face indices, per design.md §5.2. */
export const FACE_NOSE = 0;
export const FACE_EAR_LEFT = 7;
export const FACE_EAR_RIGHT = 8;
export const FACE_EYE_LEFT = 33;
export const FACE_EYE_RIGHT = 133;
export const FACE_BROW_LEFT = 105;
export const FACE_BROW_RIGHT = 334;

/** Frames used to establish the signer's neutral posture. */
export const BASELINE_FRAME_COUNT = 30;

export type SignerBaseline = {
  /** Distance between the acromion landmarks. Every other measure is scaled by this. */
  shoulderWidth: number;
  /** Neutral vertical gap between the ocular centroid and the superciliary centroid. */
  neutralBrowGap: number;
  /** Neutral vertical gap between the shoulder line and the auditory landmarks. */
  neutralShoulderEarGap: number;
  /** Neutral depth delta between the shoulder plane and the hip plane. */
  neutralDepthDelta: number;
  /** Neutral horizontal position of the nose, relative to the shoulder midpoint. */
  neutralNoseOffset: number;
  frameCount: number;
};

export function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function distance2d(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Per-signer normalization. Camera distance and body size must not leak into
 * detection, so every rule measures against these values rather than raw units.
 * Returns null when pose or face is never detected in the opening window.
 */
export function computeSignerBaseline(frames: LandmarkFrame[]): SignerBaseline | null {
  const window = frames.slice(0, BASELINE_FRAME_COUNT).filter((f) => f.pose && f.face);
  if (window.length === 0) return null;

  const shoulderWidths: number[] = [];
  const browGaps: number[] = [];
  const shoulderEarGaps: number[] = [];
  const depthDeltas: number[] = [];
  const noseOffsets: number[] = [];

  for (const frame of window) {
    const pose = frame.pose!;
    const face = frame.face!;
    const shoulderL = pose[POSE_SHOULDER_LEFT];
    const shoulderR = pose[POSE_SHOULDER_RIGHT];
    const shoulderMid = midpoint(shoulderL, shoulderR);
    const width = distance2d(shoulderL, shoulderR);
    if (width === 0) continue;

    shoulderWidths.push(width);

    const eyeMid = midpoint(face[FACE_EYE_LEFT], face[FACE_EYE_RIGHT]);
    const browMid = midpoint(face[FACE_BROW_LEFT], face[FACE_BROW_RIGHT]);
    browGaps.push((eyeMid.y - browMid.y) / width);

    const earMid = midpoint(face[FACE_EAR_LEFT], face[FACE_EAR_RIGHT]);
    shoulderEarGaps.push((shoulderMid.y - earMid.y) / width);

    const hipMid = midpoint(pose[POSE_HIP_LEFT], pose[POSE_HIP_RIGHT]);
    depthDeltas.push((shoulderMid.z - hipMid.z) / width);

    noseOffsets.push((face[FACE_NOSE].x - shoulderMid.x) / width);
  }

  if (shoulderWidths.length === 0) return null;

  return {
    shoulderWidth: mean(shoulderWidths),
    neutralBrowGap: mean(browGaps),
    neutralShoulderEarGap: mean(shoulderEarGaps),
    neutralDepthDelta: mean(depthDeltas),
    neutralNoseOffset: mean(noseOffsets),
    frameCount: window.length,
  };
}
