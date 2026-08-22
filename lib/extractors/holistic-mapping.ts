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
 * MediaPipe labels hands from the *camera's* point of view. With a front-facing
 * camera the image is mirrored, so the signer's left hand appears on the right
 * of the frame and lands in `rightHandLandmarks`. `mirrored` swaps them back so
 * "leftHand" always means the signer's own left hand — which is what a
 * linguistic annotation has to mean.
 */
export function holisticToFrame(
  result: HolisticResultLike,
  t: number,
  options: { mirrored: boolean },
): LandmarkFrame {
  const fromCameraLeft = firstOf(result.leftHandLandmarks, HAND_LANDMARK_COUNT);
  const fromCameraRight = firstOf(result.rightHandLandmarks, HAND_LANDMARK_COUNT);

  return {
    t,
    leftHand: options.mirrored ? fromCameraRight : fromCameraLeft,
    rightHand: options.mirrored ? fromCameraLeft : fromCameraRight,
    face: firstOf(result.faceLandmarks, FACE_LANDMARK_COUNT),
    pose: firstOf(result.poseLandmarks, POSE_LANDMARK_COUNT),
  };
}
