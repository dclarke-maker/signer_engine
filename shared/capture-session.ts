/**
 * Timings for continuous session mode, where a signer records a run of
 * sentences without touching the phone.
 *
 * The single-capture screen asks the signer to tap start, step back, sign, step
 * forward and tap stop. Framing the upper body and both extended arms puts the
 * phone about 1.3-1.5m away, so each of those taps is a walk: roughly 26s of
 * logistics around 4s of signing, four hundred transits across the hundred
 * sentences, and a reach toward the camera welded to the head and tail of every
 * sequence. Session mode exists to delete that.
 *
 * These are starting values, not measurements. Nobody has yet run a block with
 * a Deaf signer, and the pilot is what turns them into numbers - particularly
 * `REST_MOTION_THRESHOLD`, which is the one that can quietly damage data.
 */

/** Sentences recorded before the signer walks back to review a block. */
export const BLOCK_SIZE = 10;

/** Beat between "you are in frame" and the first count. */
export const COUNTDOWN_MS = 3_000;

/**
 * Recording never auto-stops before this. A signer settling after the count, or
 * pausing to recall a sign, must not be read as having finished.
 */
export const MIN_RECORDING_MS = 2_000;

/** Hard stop. Reached only if rest is never detected; the sample is kept. */
export const MAX_RECORDING_MS = 20_000;

/**
 * Rest must persist this long before it counts as the end of a sentence.
 * Deliberately generous: over-recording leaves trailing stillness that trims
 * cleanly, while truncating removes signed content that cannot be recovered.
 */
export const REST_HOLD_MS = 1_500;

/**
 * Hand speed below which a signer is treated as still, in frame-heights per
 * second, measured after aspect correction.
 *
 * Sits between MediaPipe's landmark jitter on a held pose and the slowest
 * deliberate signing movement, and the gap between those is not wide. Hands
 * leaving the frame is the stronger and more common rest signal; this only
 * catches a signer who lowers their hands but keeps them in view.
 */
export const REST_MOTION_THRESHOLD = 0.12;

/** How long "Saved" shows before the next sentence appears. */
export const HANDOVER_MS = 1_200;

/** Consecutive frames with face and pose before a signer counts as in frame. */
export const FRAMING_FRAMES = 12;
