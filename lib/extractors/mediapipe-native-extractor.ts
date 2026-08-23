import { decodeHolisticBase64 } from "./holistic-buffer";
import type {
  LandmarkExtractor,
  LandmarkFrame,
  LandmarkSequenceSummary,
} from "@/shared/landmarks";

/** Must match the name the Swift and Kotlin plugins register under. */
export const HOLISTIC_PLUGIN_NAME = "holisticLandmarks";

/**
 * MediaPipe holistic extraction, fed by a Vision Camera frame processor.
 *
 * **Thread boundary.** Frame processors run in a worklet runtime, which gets
 * *copies* of captured values - a counter incremented there is invisible to the
 * JS thread. So the worklet does only what must happen on the camera thread
 * (calling the native plugin) and hands the packed buffer across; decoding,
 * counting, and notifying all happen here, on JS, where the state actually
 * lives. `LandmarkCamera` owns the worklet side and marshals via
 * `Worklets.createRunOnJS`, which cannot carry an ArrayBuffer - so the packed
 * frame arrives base64-encoded. See lib/extractors/holistic-buffer.ts.
 *
 * Frames are measured and released. Nothing is retained, encoded, or written.
 */
export function createMediaPipeNativeExtractor() {
  let listener: ((frame: LandmarkFrame) => void) | null = null;
  let running = false;

  let frameCount = 0;
  // The plugin stamps time from its own first frame, and it outlives a single
  // capture - it is created when the camera mounts and reused for every prompt.
  // So the first frame of each capture defines that capture's zero.
  let originT: number | null = null;
  let lastT = 0;
  let decodeFailures = 0;
  const detected = { leftHand: 0, rightHand: 0, face: 0, pose: 0 };

  const extractor: LandmarkExtractor & {
    /** Called on the JS thread with a packed frame from the frame processor. */
    acceptPackedFrame(packed: string): void;
    readonly decodeFailures: number;
    readonly isRunning: boolean;
  } = {
    id: "mediapipe-holistic-native@1",

    async start() {
      frameCount = 0;
      originT = null;
      lastT = 0;
      decodeFailures = 0;
      detected.leftHand = detected.rightHand = detected.face = detected.pose = 0;
      running = true;
    },

    subscribe(onFrame) {
      listener = onFrame;
      return () => {
        listener = null;
      };
    },

    acceptPackedFrame(packed: string) {
      if (!running) return;

      let decoded: LandmarkFrame;
      try {
        decoded = decodeHolisticBase64(packed);
      } catch {
        // A malformed frame is dropped and counted rather than thrown. Throwing
        // would abort a capture mid-session and lose every good frame already
        // collected; the count surfaces in the summary instead.
        decodeFailures += 1;
        return;
      }

      if (originT === null) originT = decoded.t;
      decoded.t -= originT;

      frameCount += 1;
      lastT = decoded.t;
      if (decoded.leftHand) detected.leftHand += 1;
      if (decoded.rightHand) detected.rightHand += 1;
      if (decoded.face) detected.face += 1;
      if (decoded.pose) detected.pose += 1;

      listener?.(decoded);
    },

    get decodeFailures() {
      return decodeFailures;
    },

    get isRunning() {
      return running;
    },

    async stop(): Promise<LandmarkSequenceSummary> {
      running = false;
      listener = null;

      const ratio = (n: number) => (frameCount === 0 ? 0 : n / frameCount);
      // lastT is the offset of the final frame, so it spans frameCount - 1
      // intervals. Dividing by it directly overstates the rate, most visibly on
      // short captures - two frames 40ms apart would report 50fps, not 25.
      const intervals = frameCount > 1 ? frameCount - 1 : 0;
      return {
        frameCount,
        durationMs: lastT,
        achievedFps: intervals === 0 || lastT === 0 ? 0 : (intervals / lastT) * 1000,
        coverage: {
          leftHand: ratio(detected.leftHand),
          rightHand: ratio(detected.rightHand),
          face: ratio(detected.face),
          pose: ratio(detected.pose),
        },
      };
    },
  };

  return extractor;
}
