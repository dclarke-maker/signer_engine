import { CameraView } from "expo-camera";
import { useMemo } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import {
  Camera,
  VisionCameraProxy,
  runAtTargetFps,
  useCameraDevice,
  useFrameProcessor,
  type Frame,
} from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";

import { HOLISTIC_PLUGIN_NAME } from "@/lib/extractors/mediapipe-native-extractor";
import { needsPushedFrames } from "@/lib/extractors/shape";
import { TARGET_FPS } from "@/lib/extractors";
import type { LandmarkExtractor } from "@/shared/landmarks";

export type LandmarkCameraProps = {
  extractor: LandmarkExtractor;
  /** True while a capture is running; frames are only processed when set. */
  active: boolean;
  style?: ViewStyle;
};

/**
 * Renders the camera the current extractor needs, and owns the thread boundary.
 *
 * Two extractor shapes exist. Fixture and web extractors pull their own frames
 * and only need a subscriber. The native extractor is pushed packed landmark
 * buffers by a frame processor. Screens should not have to know which they
 * hold, so the decision is made here by inspecting the extractor.
 *
 * **Why the split matters.** A frame processor runs in a worklet runtime, which
 * receives *copies* of captured values - state mutated there never reaches the
 * JS thread. So the worklet does only what must happen on the camera thread
 * (calling the native plugin) and marshals the buffer across with
 * `createRunOnJS`; all counting and decoding happens on JS, where the
 * extractor's state actually lives.
 */
export function LandmarkCamera({ extractor, active, style }: LandmarkCameraProps) {
  const device = useCameraDevice("front");
  const pushed = needsPushedFrames(extractor);

  // Memoized so the worklet does not recapture a new function every render.
  const deliver = useMemo(
    () =>
      pushed
        ? Worklets.createRunOnJS((buffer: ArrayBuffer) => extractor.acceptBuffer(buffer))
        : null,
    [extractor, pushed],
  );

  const plugin = useMemo(
    () => (pushed ? VisionCameraProxy.initFrameProcessorPlugin(HOLISTIC_PLUGIN_NAME, {}) : null),
    [pushed],
  );

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      "worklet";
      if (!deliver || !plugin) return;
      // Throttled on the camera thread: MediaPipe cannot keep pace with a
      // 60fps sensor, and pushing every frame to JS would bridge work that is
      // then discarded.
      runAtTargetFps(TARGET_FPS, () => {
        "worklet";
        const packed = plugin.call(frame, { timestampMs: frame.timestamp });
        if (packed instanceof ArrayBuffer) deliver(packed);
      });
    },
    [deliver, plugin],
  );

  // A pull extractor needs no frame processor. A missing device or plugin means
  // the native side is unavailable - Expo Go, or a build without the config
  // plugin - and pairing a push extractor with a plain preview would produce a
  // capture of zero frames with no error, so that combination is refused.
  const canPush = pushed && device != null && plugin != null;

  if (!canPush) {
    if (pushed && __DEV__) {
      console.warn(
        "[LandmarkCamera] This extractor needs a frame processor, but " +
          `${device == null ? "no camera device was found" : "the holistic plugin is not registered"}. ` +
          "Showing a preview only - captures will contain no frames. " +
          "Run 'npx expo prebuild' and rebuild the development client.",
      );
    }
    return <CameraView style={style ?? StyleSheet.absoluteFill} facing="front" />;
  }

  return (
    <Camera
      style={style ?? StyleSheet.absoluteFill}
      device={device}
      isActive={active}
      frameProcessor={frameProcessor}
      // RGBA output, so the native plugin can copy a frame straight into a
      // bitmap. The YUV default would need a colour conversion per frame.
      pixelFormat="rgb"
      // The pipeline has no audio channel and never records.
      audio={false}
      video={false}
      photo={false}
    />
  );
}
