export const HAND_LANDMARK_COUNT = 21;
export const FACE_LANDMARK_COUNT = 468;
export const POSE_LANDMARK_COUNT = 33;

/**
 * MediaPipe Tasks appends ten iris landmarks - five per eye, at indices 468 to
 * 477 - to the 468-point face mesh, so a detected face arrives as 478 points.
 * The proposal and design.md both say 468, which is the mesh the non-manual
 * marker rules index into; every face index they use is below 468, so the extra
 * points are additional data rather than a different layout.
 *
 * Both counts are accepted. Rejecting 478 is not a safe default: it discards
 * every frame in which a face was found, which is every frame that matters.
 */
export const FACE_LANDMARK_COUNT_WITH_IRIS = 478;
export const FACE_LANDMARK_COUNTS = [FACE_LANDMARK_COUNT, FACE_LANDMARK_COUNT_WITH_IRIS];

export type Landmark = { x: number; y: number; z: number; visibility?: number };

/**
 * One extracted frame. A stream that was not detected is `null` rather than an
 * array of zeroes, so that "out of frame" stays distinguishable from "at the origin".
 */
export type LandmarkFrame = {
  /** Milliseconds from the start of the sequence. */
  t: number;
  leftHand: Landmark[] | null;
  rightHand: Landmark[] | null;
  face: Landmark[] | null;
  pose: Landmark[] | null;
  /**
   * Width divided by height of the frame these coordinates were normalised
   * against, after any rotation.
   *
   * Needed because x is normalised by frame width and y by frame height, so on
   * a 9:16 frame a unit of x is 0.56 of a unit of y and the two cannot be
   * compared or divided without it. Absent means 1 - square, or already
   * isotropic, which is what the fixture extractors produce.
   */
  aspect?: number;
};

export type LandmarkSequenceSummary = {
  frameCount: number;
  durationMs: number;
  achievedFps: number;
  /** Fraction of frames in which each stream was detected, 0-1. */
  coverage: { leftHand: number; rightHand: number; face: number; pose: number };
  /**
   * Frames the native plugin produced that could not be read. Non-zero means
   * the plugin and this client disagree about the packed layout, and the
   * capture is missing data rather than merely short.
   */
  decodeFailures: number;
};

export type LandmarkSequencePayload = {
  schemaVersion: 1;
  sessionId: string;
  promptId: string;
  category: string;
  extractorId: string;
  targetFps: number;
  achievedFps: number;
  frameCount: number;
  durationMs: number;
  frames: LandmarkFrame[];
};

export interface LandmarkExtractor {
  readonly id: string;
  start(options: { targetFps: number }): Promise<void>;
  subscribe(onFrame: (frame: LandmarkFrame) => void): () => void;
  stop(): Promise<LandmarkSequenceSummary>;

  /**
   * Present only on extractors that cannot pull frames themselves.
   *
   * The fixture and web extractors drive their own loop, so a screen only has
   * to subscribe. A native extractor is fed by a camera frame processor, which
   * hands it packed landmark buffers; a camera that never calls this leaves it
   * silently producing nothing. `needsPushedFrames` in lib/extractors/shape.ts
   * is how a camera decides which contract it has.
   */
  acceptPackedFrame?(packed: string): void;
}
