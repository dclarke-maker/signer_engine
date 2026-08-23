export const HAND_LANDMARK_COUNT = 21;
export const FACE_LANDMARK_COUNT = 468;
export const POSE_LANDMARK_COUNT = 33;

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
