import { FilesetResolver, HolisticLandmarker } from "@mediapipe/tasks-vision";

import { holisticToFrame } from "./holistic-mapping";
import type {
  LandmarkExtractor,
  LandmarkFrame,
  LandmarkSequenceSummary,
} from "@/shared/landmarks";

/**
 * MediaPipe Tasks holistic extraction, driven from a `<video>` element.
 *
 * This is the web implementation of `LandmarkExtractor`. It produces the exact
 * four streams the proposal specifies - face 468, pose 33, and 21 per hand -
 * from one model, which is why it maps onto `LandmarkFrame` without adaptation.
 *
 * Frames are read, measured, and dropped. Nothing is captured to a buffer,
 * encoded, or written to disk at any point in this file.
 */
export type HolisticWebOptions = {
  video: HTMLVideoElement;
  /** Front cameras present a mirrored image; see holisticToFrame. */
  mirrored?: boolean;
  /** Where the .task model and WASM binaries are served from. */
  modelAssetPath?: string;
  wasmBasePath?: string;
};

const DEFAULT_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const DEFAULT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task";

export function createHolisticWebExtractor(options: HolisticWebOptions): LandmarkExtractor {
  let landmarker: HolisticLandmarker | null = null;
  let listener: ((frame: LandmarkFrame) => void) | null = null;
  let rafId: number | null = null;
  let startedAt = 0;
  let lastVideoTime = -1;

  let frameCount = 0;
  let lastT = 0;
  const detected = { leftHand: 0, rightHand: 0, face: 0, pose: 0 };

  const tick = () => {
    const video = options.video;
    if (!landmarker || video.readyState < 2) {
      rafId = requestAnimationFrame(tick);
      return;
    }

    // detectForVideo rejects a non-increasing timestamp, and re-running on the
    // same frame would double-count it in the summary.
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const frame = holisticToFrame(result, Math.round(now - startedAt), {
        mirrored: options.mirrored ?? true,
        // Read per frame: a <video> reports 0 until metadata has loaded, and
        // claiming a square frame would quietly skew every marker downstream.
        aspect:
          video.videoWidth > 0 && video.videoHeight > 0
            ? video.videoWidth / video.videoHeight
            : undefined,
      });

      frameCount += 1;
      lastT = frame.t;
      if (frame.leftHand) detected.leftHand += 1;
      if (frame.rightHand) detected.rightHand += 1;
      if (frame.face) detected.face += 1;
      if (frame.pose) detected.pose += 1;

      listener?.(frame);
    }

    rafId = requestAnimationFrame(tick);
  };

  return {
    id: "mediapipe-holistic-web@1.0.1",

    async start() {
      const fileset = await FilesetResolver.forVisionTasks(
        options.wasmBasePath ?? DEFAULT_WASM_BASE,
      );
      landmarker = await HolisticLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: options.modelAssetPath ?? DEFAULT_MODEL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
      });

      startedAt = performance.now();
      lastVideoTime = -1;
      frameCount = 0;
      lastT = 0;
      detected.leftHand = detected.rightHand = detected.face = detected.pose = 0;
      rafId = requestAnimationFrame(tick);
    },

    subscribe(onFrame) {
      listener = onFrame;
      return () => {
        listener = null;
      };
    },

    async stop(): Promise<LandmarkSequenceSummary> {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      listener = null;
      landmarker?.close();
      landmarker = null;

      const ratio = (n: number) => (frameCount === 0 ? 0 : n / frameCount);
      // n frames span n-1 intervals; dividing by the count overstates the rate.
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
        // This path reads MediaPipe's own result objects rather than a packed
        // buffer, so there is no layout to disagree about.
        decodeFailures: 0,
      };
    },
  };
}
