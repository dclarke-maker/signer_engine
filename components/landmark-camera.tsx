import { CameraView } from "expo-camera";
import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import {
  Camera,
  VisionCameraProxy,
  runAtTargetFps,
  useCameraDevice,
  useCameraDevices,
  useFrameProcessor,
  type CameraDevice,
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
  /**
   * Called when this extractor cannot be driven, with a reason fit to show a
   * participant. Screens use it to refuse to start a capture that could only
   * produce an empty sequence.
   */
  onUnavailable?: (reason: string) => void;
};

/**
 * Picks the lens to sign into.
 *
 * Front is the only sensible lens on a phone - the signer has to see
 * themselves - but `useCameraDevice('front')` matches lens facing exactly, and
 * a USB or Continuity webcam reports `external`. Tablets and desk setups used
 * in the workshop are the case that matters, so external is accepted as a
 * second choice. Back is never used: a signer who cannot see the frame cannot
 * tell whether they stayed in it, and the sample would be unusable.
 */
function useSigningDevice(): CameraDevice | undefined {
  const front = useCameraDevice("front");
  const devices = useCameraDevices();
  return front ?? devices.find((d) => d.position === "external");
}

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
export function LandmarkCamera({ extractor, active, style, onUnavailable }: LandmarkCameraProps) {
  const device = useSigningDevice();
  const pushed = needsPushedFrames(extractor);

  // Memoized so the worklet does not recapture a new function every render.
  const deliver = useMemo(
    () =>
      pushed
        ? Worklets.createRunOnJS((packed: string) => extractor.acceptPackedFrame(packed))
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
        // A string, not an ArrayBuffer: createRunOnJS converts each argument
        // to a worklets-core shared value, and that converter rejects
        // ArrayBuffers. The plugin base64-encodes the packed frame instead.
        const packed = plugin.call(frame, { timestampMs: frame.timestamp });
        if (typeof packed === "string") deliver(packed);
      });
    },
    [deliver, plugin],
  );

  // A pull extractor needs no frame processor. A missing device or plugin means
  // the native side is unavailable - Expo Go, or a build without the config
  // plugin - and pairing a push extractor with a plain preview would produce a
  // capture of zero frames with no error, so that combination is refused.
  const canPush = pushed && device != null && plugin != null;
  const unavailableReason =
    pushed && !canPush
      ? device == null
        ? "No front-facing camera was found on this device, so motion points cannot be read."
        : "This build cannot read motion points. Please reinstall the app from the study link."
      : null;

  // Reported to the screen so it can refuse to start. Previously this was a
  // __DEV__ console warning, which is compiled out of the builds participants
  // actually receive - they saw a black preview, a running timer, and a sample
  // with no frames in it, with nothing explaining why.
  useEffect(() => {
    if (unavailableReason) onUnavailable?.(unavailableReason);
  }, [unavailableReason, onUnavailable]);

  if (unavailableReason) {
    return (
      <View style={[style ?? StyleSheet.absoluteFill, styles.unavailable]}>
        <Text style={styles.unavailableText}>{unavailableReason}</Text>
      </View>
    );
  }

  if (!canPush) {
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

const styles = StyleSheet.create({
  unavailable: {
    backgroundColor: "#102A43",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  unavailableText: { color: "#FFFFFF", fontSize: 16, lineHeight: 24, textAlign: "center" },
});
