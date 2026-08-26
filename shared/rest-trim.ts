import {
  MIN_RECORDING_MS,
  REST_HOLD_MS,
  REST_MOTION_THRESHOLD,
} from "./capture-session";
import type { Landmark, LandmarkFrame } from "./landmarks";

export type RestDetectorOptions = {
  minRecordingMs: number;
  restHoldMs: number;
  motionThreshold: number;
};

export type StopReason = "rest";

export type RestVerdict = {
  /** True once the sentence should be considered finished. */
  stop: boolean;
  reason: StopReason | null;
  /** How long the signer has been continuously still, in ms. */
  restingMs: number;
  /** Whether any signing movement has been seen yet. */
  armed: boolean;
  /** Hand speed on this frame in frame-heights per second, null if unmeasurable. */
  motion: number | null;
};

const DEFAULTS: RestDetectorOptions = {
  minRecordingMs: MIN_RECORDING_MS,
  restHoldMs: REST_HOLD_MS,
  motionThreshold: REST_MOTION_THRESHOLD,
};

/**
 * Mean per-landmark hand speed between two frames, in frame-heights per second.
 *
 * x is normalised by frame width and y by frame height, so on a 9:16 frame a
 * unit of horizontal movement is 0.5625 of a unit of vertical movement. Signing
 * is largely horizontal, so comparing raw dx against a fixed threshold would
 * under-read lateral movement by nearly half and call a moving signer still.
 * Scaling x into units of height is the same correction server/nmm/isotropic.ts
 * applies, for the same reason.
 *
 * Returns null when no hand is present in both frames, which is not stillness -
 * it is the absence of evidence, and the caller distinguishes the two.
 */
export function handSpeed(
  previous: LandmarkFrame,
  next: LandmarkFrame,
  aspect: number,
): number | null {
  const dt = next.t - previous.t;
  if (dt <= 0) return null;

  let total = 0;
  let counted = 0;
  for (const side of ["leftHand", "rightHand"] as const) {
    const before = previous[side];
    const after = next[side];
    if (!before || !after || before.length !== after.length) continue;
    for (let i = 0; i < after.length; i += 1) {
      total += distance(before[i], after[i], aspect);
      counted += 1;
    }
  }
  if (counted === 0) return null;
  return (total / counted / dt) * 1000;
}

function distance(a: Landmark, b: Landmark, aspect: number): number {
  const dx = (b.x - a.x) * aspect;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Finds where a signer stopped signing, **after the fact**.
 *
 * This ran live on the device until a measured ten-sentence run showed it
 * cannot: it ended three sentences correctly and let seven reach the time
 * limit. The cause is not a badly chosen threshold. Resting hands held at the
 * waist moved at a median 0.128 frame-heights per second and the threshold
 * separating rest from signing was 0.12 - the same number - while raising it
 * far enough to catch rest made stretches of real signing read as still. One
 * frame does not carry the evidence needed to tell the two apart.
 *
 * So the decision moved here, where it is reversible. The device records a
 * fixed window and stores every frame; this proposes a trim afterwards, and a
 * proposal that is wrong costs nothing and can be recomputed with a different
 * threshold against real signing.
 *
 * Two guards remain, and both still matter because trailing stillness is cheap
 * and a truncated utterance is not:
 *
 * **It must see movement first.** After the countdown a signer stands still
 * with their hands down, which is indistinguishable from having finished.
 *
 * **Rest has to persist.** A held handshape is stillness that carries meaning;
 * sign languages use holds as content.
 */
export function createRestDetector(options: Partial<RestDetectorOptions> = {}) {
  const config = { ...DEFAULTS, ...options };

  let previous: LandmarkFrame | null = null;
  let restingSince: number | null = null;
  let armed = false;
  let stopped: StopReason | null = null;

  const verdict = (restingMs: number, motion: number | null): RestVerdict => ({
    stop: stopped !== null,
    reason: stopped,
    restingMs,
    armed,
    motion,
  });

  return {
    /** Feeds one frame and reports whether recording should end. */
    accept(frame: LandmarkFrame): RestVerdict {
      if (stopped) return verdict(0, null);

      const aspect = frame.aspect ?? 1;
      const motion = previous ? handSpeed(previous, frame, aspect) : null;
      previous = frame;

      // Hands gone from the frame is the ordinary way a signer signals they are
      // done - they drop them to their sides or lap. Read as stillness, not as
      // missing data, because it is the most reliable rest signal there is.
      const handsVisible = frame.leftHand !== null || frame.rightHand !== null;
      const still =
        !handsVisible || (motion !== null && motion < config.motionThreshold);

      if (!still && motion !== null) armed = true;

      if (still) {
        restingSince ??= frame.t;
      } else {
        restingSince = null;
      }

      const restingMs = restingSince === null ? 0 : frame.t - restingSince;

      if (
        armed &&
        frame.t >= config.minRecordingMs &&
        restingMs >= config.restHoldMs
      ) {
        stopped = "rest";
      }

      return verdict(restingMs, motion);
    },

    reset() {
      previous = null;
      restingSince = null;
      armed = false;
      stopped = null;
    },
  };
}

export type TrimProposal = {
  /** Frames up to and including this index are kept. */
  endIndex: number;
  /** Timestamp of the last kept frame, ms from the start of the sequence. */
  endMs: number;
  /** Frames the proposal would drop from the tail. */
  droppedFrames: number;
  /** Milliseconds of trailing stillness the proposal would drop. */
  droppedMs: number;
  /** False when no confident resting point was found and nothing should be cut. */
  found: boolean;
};

/**
 * Where a stored sequence could be cut, without cutting it.
 *
 * Returns the whole sequence with `found: false` when no resting point is
 * confidently identified, which on the run this was measured against is the
 * common case. Reporting a trim it cannot justify would be worse than
 * reporting none: the trailing stillness is inert, and a wrongly removed
 * ending is signed content nothing downstream can recover.
 */
export function proposeTrim(
  frames: LandmarkFrame[],
  options: Partial<RestDetectorOptions> = {},
): TrimProposal {
  const whole = (found: boolean): TrimProposal => ({
    endIndex: frames.length - 1,
    endMs: frames.length ? frames[frames.length - 1].t : 0,
    droppedFrames: 0,
    droppedMs: 0,
    found,
  });
  if (frames.length === 0) return { ...whole(false), endIndex: -1 };

  const detector = createRestDetector(options);
  const holdMs = options.restHoldMs ?? REST_HOLD_MS;

  for (let i = 0; i < frames.length; i += 1) {
    const verdict = detector.accept(frames[i]);
    if (!verdict.stop) continue;
    // The stop lands at the far end of the hold window, so the signing itself
    // ended when the stillness began. Cutting at the stop would keep the whole
    // hold; cutting before it risks the last moments of the sentence.
    const cutAt = frames[i].t - holdMs;
    let end = i;
    while (end > 0 && frames[end].t > cutAt) end -= 1;
    const last = frames[frames.length - 1];
    return {
      endIndex: end,
      endMs: frames[end].t,
      droppedFrames: frames.length - 1 - end,
      droppedMs: last.t - frames[end].t,
      found: true,
    };
  }
  return whole(false);
}
