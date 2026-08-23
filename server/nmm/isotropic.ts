import type { Landmark, LandmarkFrame } from "../../shared/landmarks";

/**
 * Rescales normalised landmarks so that a unit of x and a unit of y are the
 * same physical length.
 *
 * MediaPipe normalises x by frame width and y by frame height, so on a 9:16
 * frame a unit of x is 0.5625 of a unit of y. Every rule here divides a
 * vertical measure - a brow gap, a shoulder-to-ear gap - by shoulder width,
 * which is horizontal. Without this correction each of those signals carries a
 * hidden factor of width/height, so the same gesture yields a different number
 * on a 16:9 phone than on a 4:3 tablet while the thresholds stay fixed.
 * `body_tilt` is worse: it takes atan2 over two differently scaled components
 * and compares the result against a threshold in radians, so it is not the
 * angle of the shoulder line at all.
 *
 * Scaling x up into units of frame height, rather than scaling y down, leaves
 * the vertical measures the rules are built around untouched.
 *
 * z is rescaled with x: MediaPipe documents it as being on roughly the same
 * scale as x. Leaving it alone would break `forward_lean`, which is currently
 * correct only because its z and its shoulder width share the same normaliser.
 */
function scaleLandmark(point: Landmark, aspect: number): Landmark {
  return {
    x: point.x * aspect,
    y: point.y,
    z: point.z * aspect,
    ...(point.visibility === undefined ? {} : { visibility: point.visibility }),
  };
}

function scaleStream(stream: Landmark[] | null, aspect: number): Landmark[] | null {
  return stream === null ? null : stream.map((p) => scaleLandmark(p, aspect));
}

/**
 * Returns the frame in a space where distances and angles mean what they look
 * like. A frame with no aspect ratio, or a square one, is returned untouched -
 * the fixture extractors already work in square space.
 */
export function toIsotropic(frame: LandmarkFrame): LandmarkFrame {
  const aspect = frame.aspect ?? 1;
  if (aspect === 1) return frame;

  return {
    ...frame,
    aspect: 1,
    face: scaleStream(frame.face, aspect),
    pose: scaleStream(frame.pose, aspect),
    leftHand: scaleStream(frame.leftHand, aspect),
    rightHand: scaleStream(frame.rightHand, aspect),
  };
}

/** Convenience for the two entry points that take a whole sequence. */
export function toIsotropicSequence(frames: LandmarkFrame[]): LandmarkFrame[] {
  return frames.map(toIsotropic);
}
