import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
} from "@/shared/landmarks";

/**
 * The subset of MediaPipe's HolisticLandmarkerResult this pipeline reads.
 * Declared structurally rather than imported so the mapping stays testable
 * without loading the WASM package.
 */
export type HolisticResultLike = {
  faceLandmarks: { x: number; y: number; z: number; visibility?: number }[][];
  poseLandmarks: { x: number; y: number; z: number; visibility?: number }[][];
  leftHandLandmarks: { x: number; y: number; z: number; visibility?: number }[][];
  rightHandLandmarks: { x: number; y: number; z: number; visibility?: number }[][];
};

/**
 * Takes the first detected instance of a stream and validates its length.
 *
 * A stream that is absent, empty, or the wrong size becomes null rather than a
 * partial array: the NMM rules index specific landmarks by position, so a
 * short array would silently read the wrong anatomy instead of failing.
 */
function firstOf(
  groups: { x: number; y: number; z: number; visibility?: number }[][] | undefined,
  expected: number,
): Landmark[] | null {
  const first = groups?.[0];
  if (!first || first.length !== expected) return null;
  return first.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    ...(p.visibility === undefined ? {} : { visibility: p.visibility }),
  }));
}

/**
 * MediaPipe names hands anatomically, but for the person *as depicted in the
 * image it was given*. A mirrored frame depicts a mirrored person, so the
 * labels come back swapped relative to the real signer, and `mirrored` swaps
 * them back — "leftHand" then means the signer's own left hand, which is what a
 * linguistic annotation has to mean.
 *
 * `aspect` is width over height of the frame the coordinates were normalised
 * against. The non-manual marker rules divide vertical measures by shoulder
 * width and cannot do so correctly without it; omitting it claims a square
 * frame. See server/nmm/isotropic.ts.
 */
export function holisticToFrame(
  result: HolisticResultLike,
  t: number,
  options: { mirrored: boolean; aspect?: number },
): LandmarkFrame {
  const fromCameraLeft = firstOf(result.leftHandLandmarks, HAND_LANDMARK_COUNT);
  const fromCameraRight = firstOf(result.rightHandLandmarks, HAND_LANDMARK_COUNT);

  return {
    t,
    aspect: options.aspect,
    leftHand: options.mirrored ? fromCameraRight : fromCameraLeft,
    rightHand: options.mirrored ? fromCameraLeft : fromCameraRight,
    face: firstOf(result.faceLandmarks, FACE_LANDMARK_COUNT),
    pose: firstOf(result.poseLandmarks, POSE_LANDMARK_COUNT),
  };
}
