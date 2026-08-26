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
 */

/** Sentences recorded before the signer walks back to review a block. */
export const BLOCK_SIZE = 10;

/** Beat between "you are in frame" and the first count. */
export const COUNTDOWN_MS = 3_000;

/**
 * How long each sentence records for.
 *
 * A fixed window, not a detected ending. An earlier version watched the
 * landmarks and stopped when the signer came to rest; measured against a real
 * ten-sentence run it ended three of ten correctly and let seven run to the
 * time limit, and no threshold fixed it - see docs/collection-session-mode.md
 * for the numbers. The reason is structural rather than a badly chosen
 * constant: resting hands and slowly-signing hands move at the same speed, so
 * the evidence needed to tell them apart is not in a single frame.
 *
 * Ending on the device is irreversible and made from one frame of evidence.
 * The landmarks are all stored, so the same judgement made afterwards costs
 * nothing when it is wrong and can be re-run against real signing without
 * re-collecting anything. That is `shared/rest-trim.ts`.
 *
 * Generous on purpose: a signer waiting out the tail of the window is cheap,
 * and a sentence cut short is not.
 */
export const RECORDING_WINDOW_MS = 12_000;

/** How long "Saved" shows before the next sentence appears. */
export const HANDOVER_MS = 1_200;

/** Consecutive frames with face and pose before a signer counts as in frame. */
export const FRAMING_FRAMES = 12;

// -- Offline trimming ------------------------------------------------------
// Used by shared/rest-trim.ts after the fact, never on the device.

/** Trailing rest must persist this long to count as the end of a sentence. */
export const REST_HOLD_MS = 1_500;

/** No sentence is trimmed shorter than this, whatever the landmarks say. */
export const MIN_RECORDING_MS = 2_000;

/**
 * Hand speed below which a signer is treated as still, in frame-heights per
 * second, measured after aspect correction.
 *
 * **Measured, and known to be inadequate on its own.** Over one ten-sentence
 * run, resting hands held at the waist had a median speed of 0.128 across the
 * final four seconds. This threshold was 0.12. They are the same number, which
 * is why the live detector behaved like a coin flip. Raising it to 0.3 makes
 * stretches of actual signing read as still.
 *
 * It stays here because trimming is now reversible and the value is meant to be
 * fitted against real NSL at the NDFN pilot - the run that produced these
 * numbers was hand movement, not signing, and did not exercise the signing
 * space. Until then the trimmer reports what it would cut without cutting it.
 */
export const REST_MOTION_THRESHOLD = 0.12;
