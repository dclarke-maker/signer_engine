import {
  MAX_RECORDING_MS,
  MIN_RECORDING_MS,
  REST_HOLD_MS,
  REST_MOTION_THRESHOLD,
} from "@/shared/capture-session";
import type { Landmark, LandmarkFrame } from "@/shared/landmarks";

export type RestDetectorOptions = {
  minRecordingMs: number;
  maxRecordingMs: number;
  restHoldMs: number;
  motionThreshold: number;
};

export type StopReason = "rest" | "max-duration";

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
  maxRecordingMs: MAX_RECORDING_MS,
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
 * Decides when a signer has finished a sentence, so nobody has to walk back to
 * the phone to press stop.
 *
 * Two guards keep it from cutting a sentence short, and both matter more than
 * stopping promptly:
 *
 * **It must see movement first.** After the countdown a signer is standing
 * still with their hands down, which is indistinguishable from having finished.
 * Without this the detector would stop every sentence before it began.
 *
 * **Rest has to persist.** A hold mid-sentence - a pause for emphasis, or
 * recalling a sign - is still, and sign languages use held handshapes as
 * content. Requiring a sustained rest window trades a little trailing stillness,
 * which trims cleanly, for not amputating the end of an utterance, which cannot
 * be recovered without asking the signer to record it again.
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

      if (frame.t >= config.maxRecordingMs) {
        stopped = "max-duration";
      } else if (
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
