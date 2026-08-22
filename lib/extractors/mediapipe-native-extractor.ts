import { VisionCameraProxy, type Frame } from "react-native-vision-camera";

import { decodeHolisticBuffer } from "./holistic-buffer";
import type {
  LandmarkExtractor,
  LandmarkFrame,
  LandmarkSequenceSummary,
} from "@/shared/landmarks";

/** Must match the name the Swift and Kotlin plugins register under. */
export const HOLISTIC_PLUGIN_NAME = "holisticLandmarks";

export type NativeHolisticOptions = {
  /** Front cameras mirror the image; see decodeHolisticBuffer. */
  mirrored?: boolean;
  /** Milliseconds between processed frames. 33 targets ~30fps. */
  minIntervalMs?: number;
};

/**
 * MediaPipe Tasks holistic extraction through a Vision Camera frame processor.
 *
 * Unlike the web and fixture extractors, this one cannot pull frames itself:
 * Vision Camera pushes them from a worklet thread. The capture screen owns the
 * frame processor and calls `processFrame` for each frame; everything else -
 * counting, coverage, and summarising - happens here so the screen holds no
 * pipeline logic.
 *
 * Frames are measured and released. Nothing is retained, encoded, or written.
 */
export function createMediaPipeNativeExtractor(options: NativeHolisticOptions = {}) {
  const mirrored = options.mirrored ?? true;
  const minIntervalMs = options.minIntervalMs ?? 33;

  let plugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
  let listener: ((frame: LandmarkFrame) => void) | null = null;
  let startedAt = 0;
  let lastAcceptedAt = -Infinity;
  let running = false;

  let frameCount = 0;
  let lastT = 0;
  let decodeFailures = 0;
  const detected = { leftHand: 0, rightHand: 0, face: 0, pose: 0 };

  const extractor: LandmarkExtractor & {
    processFrame(frame: Frame, nowMs: number): void;
    readonly decodeFailures: number;
  } = {
    id: "mediapipe-holistic-native@1",

    async start() {
      plugin = VisionCameraProxy.initFrameProcessorPlugin(HOLISTIC_PLUGIN_NAME, {});
      if (plugin == null) {
        throw new Error(
          `The ${HOLISTIC_PLUGIN_NAME} frame processor plugin is not registered. ` +
            "Run 'npx expo prebuild' and rebuild the development client.",
        );
      }
      startedAt = 0;
      lastAcceptedAt = -Infinity;
      frameCount = 0;
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

    /**
     * Called from the frame processor worklet for every camera frame. Throttles
     * to the target interval, because MediaPipe cannot keep up with a 60fps
     * camera and an unbounded queue would grow without bound.
     */
    processFrame(frame: Frame, nowMs: number) {
      if (!running || plugin == null) return;
      if (nowMs - lastAcceptedAt < minIntervalMs) return;
      lastAcceptedAt = nowMs;
      if (startedAt === 0) startedAt = nowMs;

      const packed = plugin.call(frame, { timestampMs: nowMs - startedAt });
      if (!(packed instanceof ArrayBuffer)) return;

      let decoded: LandmarkFrame;
      try {
        decoded = decodeHolisticBuffer(packed, { mirrored });
      } catch {
        // A malformed frame is dropped and counted rather than thrown: throwing
        // from a worklet would tear down the capture mid-session, losing every
        // good frame already collected.
        decodeFailures += 1;
        return;
      }

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

    async stop(): Promise<LandmarkSequenceSummary> {
      running = false;
      listener = null;
      plugin = null;

      const ratio = (n: number) => (frameCount === 0 ? 0 : n / frameCount);
      return {
        frameCount,
        durationMs: lastT,
        achievedFps: lastT === 0 ? 0 : (frameCount / lastT) * 1000,
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
