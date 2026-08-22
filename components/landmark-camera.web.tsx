import { CameraView } from "expo-camera";
import { StyleSheet, type ViewStyle } from "react-native";

import type { LandmarkExtractor } from "@/shared/landmarks";

export type LandmarkCameraProps = {
  extractor: LandmarkExtractor;
  /** True while a capture is running. */
  active: boolean;
  style?: ViewStyle;
};

/**
 * Web preview.
 *
 * Vision Camera is deliberately absent from this file: importing it would pull
 * native-only modules into the web bundle. The web and fixture extractors pull
 * their own frames, so this renders a preview and nothing more.
 */
export function LandmarkCamera({ style }: LandmarkCameraProps) {
  return <CameraView style={style ?? StyleSheet.absoluteFill} facing="front" />;
}
