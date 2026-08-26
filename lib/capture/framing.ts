import { FRAMING_FRAMES } from "@/shared/capture-session";
import type { LandmarkFrame } from "@/shared/landmarks";

/**
 * Whether enough of the signer is visible to begin.
 *
 * Face and body only. Hands are deliberately not required: a signer waiting for
 * the count stands with their hands down, often below the frame, and demanding
 * to see them would stall the countdown until they raised their arms and held
 * them there - which is neither natural nor what the sentence starts from.
 */
export function isInFrame(frame: LandmarkFrame): boolean {
  return frame.face !== null && frame.pose !== null;
}

/**
 * Holds the countdown until the signer has actually walked back into shot.
 *
 * A fixed delay would have to guess how long that takes, and would be wrong in
 * both directions - too short for someone setting a chair straight, needlessly
 * long for the nine sentences after the first, where the signer never moved.
 * Waiting for the landmarks themselves is self-adjusting and needs no guess.
 *
 * A run of consecutive frames rather than a single one, because detection
 * flickers at the edge of the frame and one lucky frame is not being in shot.
 */
export function createFramingGate(required: number = FRAMING_FRAMES) {
  let run = 0;
  return {
    accept(frame: LandmarkFrame): boolean {
      run = isInFrame(frame) ? run + 1 : 0;
      return run >= required;
    },
    get progress(): number {
      return Math.min(1, run / required);
    },
    reset() {
      run = 0;
    },
  };
}
