import { useIsFocused } from "@react-navigation/native";
import { CameraView } from "expo-camera";
import { useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, Text, View, type ViewStyle } from "react-native";
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
  /**
   * True while a capture is running. This gates *processing*, not the preview:
   * a signer has to be able to see themselves to get into frame before they
   * start, and this screen asks them to keep their hands, face, and upper body
   * in view.
   */
  active: boolean;
  style?: ViewStyle;
  /**
   * Called when this extractor cannot be driven, with a reason fit to show a
   * participant. Screens use it to refuse to start a capture that could only
   * produce an empty sequence.
   */
  onUnavailable?: (reason: string) => void;
  /**
   * Called with true once the camera is actually producing a picture, and false
   * when it stops. A camera takes a second or two to open, and a capture begun
   * before then records a signer who cannot yet see themselves.
   */
  onPreviewStateChange?: (streaming: boolean) => void;
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
function useSigningDevice(): {
  device: CameraDevice | undefined;
  devices: CameraDevice[];
} {
  const front = useCameraDevice("front");
  const devices = useCameraDevices();
  return {
    device: front ?? devices.find((d) => d.position === "external"),
    devices,
  };
}

/**
 * Guards against waiting forever for a device list that will never arrive.
 *
 * A phone genuinely without a usable camera reports an empty list and stays
 * that way, which is the same shape as enumeration still running. This settles
 * to true after a grace period so that case still reaches the signer with an
 * explanation rather than an indefinite "opening the camera".
 */
function useSettledAfter(ms: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return settled;
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
/**
 * Whether the camera should be streaming at all.
 *
 * A camera left running behind another screen, or after the app is backgrounded,
 * holds the device open and costs power for nothing - and on a screen whose
 * whole promise is that nothing is recorded, a camera still streaming while the
 * app is in the background is the wrong thing to do regardless of cost.
 */
function useCameraShouldStream(): boolean {
  const isFocused = useIsFocused();
  const [inForeground, setInForeground] = useState(
    () => AppState.currentState === "active",
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) =>
      setInForeground(next === "active"),
    );
    return () => sub.remove();
  }, []);

  return isFocused && inForeground;
}

export function LandmarkCamera({
  extractor,
  active,
  style,
  onUnavailable,
  onPreviewStateChange,
}: LandmarkCameraProps) {
  const { device, devices } = useSigningDevice();
  const settled = useSettledAfter(4000);
  const pushed = needsPushedFrames(extractor);
  const streaming = useCameraShouldStream();

  // Memoized so the worklet does not recapture a new function every render.
  const deliver = useMemo(
    () =>
      pushed
        ? Worklets.createRunOnJS((packed: string) =>
            extractor.acceptPackedFrame(packed),
          )
        : null,
    [extractor, pushed],
  );

  const plugin = useMemo(
    () =>
      pushed
        ? VisionCameraProxy.initFrameProcessorPlugin(HOLISTIC_PLUGIN_NAME, {})
        : null,
    [pushed],
  );

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      "worklet";
      if (!deliver || !plugin) return;
      // The preview runs whenever this screen is up, so most frames arrive
      // while nobody is capturing. Returning before plugin.call keeps the
      // landmarker off the CPU until it is wanted.
      if (!active) return;
      // Throttled on the camera thread: MediaPipe cannot keep pace with a
      // 60fps sensor, and pushing every frame to JS would bridge work that is
      // then discarded.
      runAtTargetFps(TARGET_FPS, () => {
        "worklet";
        // No timestamp is passed: frame.timestamp is nanoseconds on Android
        // and milliseconds on iOS, so the plugin stamps its own monotonic
        // millisecond clock instead.
        //
        // A string, not an ArrayBuffer: createRunOnJS converts each argument
        // to a worklets-core shared value, and that converter rejects
        // ArrayBuffers. The plugin base64-encodes the packed frame instead.
        const packed = plugin.call(frame);
        if (typeof packed === "string") deliver(packed);
      });
    },
    [deliver, plugin, active],
  );

  // A pull extractor needs no frame processor. A missing device or plugin means
  // the native side is unavailable - Expo Go, or a build without the config
  // plugin - and pairing a push extractor with a plain preview would produce a
  // capture of zero frames with no error, so that combination is refused.
  const canPush = pushed && device != null && plugin != null;

  // VisionCamera enumerates devices natively and reports an empty list until it
  // finishes. Read literally that is indistinguishable from a phone with no
  // camera, and screens latch the reason permanently - so a cold start raced
  // the enumeration and told the signer their phone had no front camera, on a
  // phone that had one. An empty list means "not yet"; only a list that has
  // arrived without a usable lens in it means "no camera".
  const resolving =
    pushed && device == null && devices.length === 0 && !settled;
  const unavailableReason =
    pushed && !canPush && !resolving
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

  if (resolving) {
    return (
      <View style={[style ?? StyleSheet.absoluteFill, styles.unavailable]} />
    );
  }

  if (!canPush) {
    // A pull extractor produces frames without a camera, so there is nothing to
    // wait for; reporting ready keeps screens from blocking on a signal that
    // will never arrive.
    return (
      <CameraView
        style={style ?? StyleSheet.absoluteFill}
        facing="front"
        onCameraReady={() => onPreviewStateChange?.(true)}
      />
    );
  }

  return (
    <Camera
      style={style ?? StyleSheet.absoluteFill}
      device={device}
      isActive={streaming}
      frameProcessor={frameProcessor}
      // RGBA output, so the native plugin can copy a frame straight into a
      // bitmap. The YUV default would need a colour conversion per frame.
      pixelFormat="rgb"
      onPreviewStarted={() => onPreviewStateChange?.(true)}
      onPreviewStopped={() => onPreviewStateChange?.(false)}
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
  unavailableText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
});
