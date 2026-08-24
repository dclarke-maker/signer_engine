import type { Landmark, LandmarkFrame } from "../../shared/landmarks";
import { toIsotropicSequence } from "./isotropic";
import { getThresholdProfile } from "./thresholds";

/**
 * Pose indices, per design.md §5.2.
 *
 * The nose and the ears are read from the pose model, not the face mesh. The
 * proposal's table lists them under "Face: 0" and "Face: 7, 8", but those are
 * pose indices: the face mesh covers the face surface and has no ear landmark
 * at any index, while pose 7 and 8 are the ears and pose 0 is the nose. Checked
 * against a real capture, face[7] and face[8] sit near one eye and the nose
 * bridge - not a symmetric pair, so averaging them produced a point that was not
 * on the head's midline at all.
 */
export const POSE_NOSE = 0;
export const POSE_EAR_LEFT = 7;
export const POSE_EAR_RIGHT = 8;
export const POSE_SHOULDER_LEFT = 11;
export const POSE_SHOULDER_RIGHT = 12;
export const POSE_HIP_LEFT = 23;
export const POSE_HIP_RIGHT = 24;

/**
 * Face mesh indices, per design.md §5.2.
 *
 * Each eye needs its own pair of corners. 33 and 133 are the outer and inner
 * corners of one eye, not one eye each - measured on a real capture they sit at
 * dx -0.289 and -0.096 of the face width, both on the same side. Averaging them
 * gives the centre of a single eye, which a head tilt then moves independently
 * of the brows it is compared against. 263 and 362 are the other eye.
 */
export const FACE_EYE_A_OUTER = 33;
export const FACE_EYE_A_INNER = 133;
export const FACE_EYE_B_OUTER = 263;
export const FACE_EYE_B_INNER = 362;
export const FACE_BROW_A = 105;
export const FACE_BROW_B = 334;

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
  /**
   * Neutral angle of the shoulder line, signed, in radians.
   *
   * A camera is never square to a signer - a phone on a stand is angled by
   * definition - and people do not sit level. Without this, body_tilt measured
   * an absolute angle against a fixed threshold and tagged an entire session as
   * one continuous tilt.
   */
  neutralShoulderAngle: number;
  frameCount: number;
};

export function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Centre of the two eyes, each taken as the midpoint of its own corners. */
export function ocularCentroid(face: Landmark[]): Landmark {
  return midpoint(
    midpoint(face[FACE_EYE_A_OUTER], face[FACE_EYE_A_INNER]),
    midpoint(face[FACE_EYE_B_OUTER], face[FACE_EYE_B_INNER]),
  );
}

/**
 * Whether MediaPipe could actually see this landmark.
 *
 * A missing score means the stream does not carry one - the face mesh does not
 * - and is treated as visible, because absence of the measure is not evidence
 * of occlusion.
 */
export function isVisible(point: Landmark, min: number): boolean {
  return point.visibility === undefined || point.visibility >= min;
}

/** True when every listed pose index is visible enough to measure. */
export function posePointsVisible(pose: Landmark[], indices: number[], min: number): boolean {
  return indices.every((i) => isVisible(pose[i], min));
}

export function distance2d(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Signed angle of the shoulder line from horizontal, in radians.
 *
 * Measured against the absolute horizontal separation so the result is the
 * departure from horizontal rather than which shoulder is on which side:
 * MediaPipe puts the right shoulder at a smaller x than the left in an
 * unmirrored frame, and a signed denominator makes atan2 return roughly pi.
 * The sign is kept so a tilt one way is distinguishable from the other.
 */
export function shoulderAngle(left: Landmark, right: Landmark): number {
  return Math.atan2(right.y - left.y, Math.abs(right.x - left.x));
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Per-signer normalization. Camera distance and body size must not leak into
 * detection, so every rule measures against these values rather than raw units.
 * Returns null when pose or face is never detected in the opening window.
 */
export function computeSignerBaseline(
  rawFrames: LandmarkFrame[],
  options: { minVisibility?: number } = {},
): SignerBaseline | null {
  const minVisibility = options.minVisibility ?? getThresholdProfile().minVisibility;
  // The baseline is a set of ratios the rules subtract from, so it has to be
  // measured in the same space they work in.
  const frames = toIsotropicSequence(rawFrames);
  const window = frames.slice(0, BASELINE_FRAME_COUNT).filter((f) => f.pose && f.face);
  if (window.length === 0) return null;

  const shoulderWidths: number[] = [];
  const browGaps: number[] = [];
  const shoulderEarGaps: number[] = [];
  const depthDeltas: number[] = [];
  const noseOffsets: number[] = [];
  const shoulderAngles: number[] = [];

  for (const frame of window) {
    const pose = frame.pose!;
    const face = frame.face!;
    const shoulderL = pose[POSE_SHOULDER_LEFT];
    const shoulderR = pose[POSE_SHOULDER_RIGHT];
    const shoulderMid = midpoint(shoulderL, shoulderR);
    const width = distance2d(shoulderL, shoulderR);
    if (width === 0) continue;

    shoulderWidths.push(width);

    const eyeMid = ocularCentroid(face);
    const browMid = midpoint(face[FACE_BROW_A], face[FACE_BROW_B]);
    browGaps.push((eyeMid.y - browMid.y) / width);

    const earMid = midpoint(pose[POSE_EAR_LEFT], pose[POSE_EAR_RIGHT]);
    shoulderEarGaps.push((shoulderMid.y - earMid.y) / width);

    // Only when the hips were actually seen; otherwise this neutral would be
    // the mean of a number MediaPipe made up.
    if (posePointsVisible(pose, [POSE_HIP_LEFT, POSE_HIP_RIGHT], minVisibility)) {
      const hipMid = midpoint(pose[POSE_HIP_LEFT], pose[POSE_HIP_RIGHT]);
      depthDeltas.push((shoulderMid.z - hipMid.z) / width);
    }

    noseOffsets.push((pose[POSE_NOSE].x - shoulderMid.x) / width);
    shoulderAngles.push(shoulderAngle(shoulderL, shoulderR));
  }

  if (shoulderWidths.length === 0) return null;

  return {
    shoulderWidth: mean(shoulderWidths),
    neutralBrowGap: mean(browGaps),
    neutralShoulderEarGap: mean(shoulderEarGaps),
    neutralDepthDelta: mean(depthDeltas),
    neutralNoseOffset: mean(noseOffsets),
    neutralShoulderAngle: mean(shoulderAngles),
    frameCount: window.length,
  };
}
