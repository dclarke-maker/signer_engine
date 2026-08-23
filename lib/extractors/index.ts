import { Platform } from "react-native";

import { createFixtureExtractor } from "./fixture-extractor";
import { createMediaPipeNativeExtractor } from "./mediapipe-native-extractor";
import { demoSequence } from "./demo-sequence";
import type { LandmarkExtractor } from "@/shared/landmarks";

export const TARGET_FPS = 30;

/**
 * Selects the extraction runtime.
 *
 * The screens depend only on this function and on `LandmarkExtractor`, so the
 * runtime can change without touching any of them.
 *
 * - Native builds use the MediaPipe holistic frame processor. It requires a
 *   development client produced by `expo prebuild`; Expo Go cannot load a
 *   frame-processor plugin, so the fixture is used there instead.
 * - Web and Expo Go replay a deterministic fixture. `holistic-web-extractor`
 *   is the real web implementation but still needs a `<video>` source.
 */
export function getExtractor(): LandmarkExtractor {
  if (Platform.OS === "web") return createFixtureExtractor(demoSequence);
  if (!hasFrameProcessors()) return createFixtureExtractor(demoSequence);
  // Throttling now happens on the camera thread in LandmarkCamera, where
  // frames can be dropped before they cross to JS.
  return createMediaPipeNativeExtractor();
}

/**
 * Vision Camera's frame processors are unavailable in Expo Go, where the native
 * module is absent. Probing here keeps the app usable in Expo Go on the fixture
 * rather than crashing on a missing plugin.
 */
function hasFrameProcessors(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VisionCameraProxy } = require("react-native-vision-camera");
    return typeof VisionCameraProxy?.initFrameProcessorPlugin === "function";
  } catch {
    return false;
  }
}
