import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function CaptureScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signerQuery = trpc.signer.me.useQuery();

  useEffect(() => {
    if (!signerQuery.isLoading && !signerQuery.data) router.replace("/sign-in");
  }, [signerQuery.data, signerQuery.isLoading]);

  const requestPermissions = async () => {
    await requestCameraPermission();
    await requestMicrophonePermission();
  };

  const record = async () => {
    if (!cameraRef.current) return;
    if (Platform.OS === "web") {
      setMessage("Video recording is available when this flow is opened in the native mobile client.");
      return;
    }

    try {
      setMessage(null);
      setIsRecording(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const video = await cameraRef.current.recordAsync({ maxDuration: 45 });
      if (video?.uri) {
        router.replace({ pathname: "/capture-review", params: { recordingUri: video.uri } } as never);
      }
    } catch {
      setMessage("The recording could not be saved. Please check device permissions and try again.");
    } finally {
      setIsRecording(false);
    }
  };

  const stop = () => {
    cameraRef.current?.stopRecording();
  };

  const hasPermissions = cameraPermission?.granted && microphonePermission?.granted;

  if (signerQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.loading}>
          <ActivityIndicator color="#0F766E" />
          <Text style={styles.loadingText}>Checking signer access…</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!hasPermissions) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.permissionContent}>
          <View style={styles.permissionIcon}><Text style={styles.permissionIconText}>⌁</Text></View>
          <Text style={styles.permissionTitle}>Prepare to capture</Text>
          <Text style={styles.permissionText}>
            SignBridge needs camera and microphone access to record a short signing sample. The preview only
            opens after you allow access.
          </Text>
          <Pressable onPress={requestPermissions} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>Allow camera and microphone</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.fullScreen}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" mode="video" />
      <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-transparent" safeAreaClassName="bg-transparent">
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <Text style={styles.iconButtonText}>×</Text>
            </Pressable>
            <View style={styles.captureBadge}><Text style={styles.captureBadgeText}>{isRecording ? "Recording" : "Capture sample"}</Text></View>
            <View style={styles.iconSpacer} />
          </View>

          <View style={styles.frameWrap}>
            <View style={styles.frame} />
            <Text style={styles.frameText}>Keep hands and upper body in view</Text>
          </View>

          <View style={styles.controlCard}>
            <Text style={styles.controlTitle}>{isRecording ? "Sign naturally" : "Ready when you are"}</Text>
            <Text style={styles.controlText}>{isRecording ? "Tap stop when you finish." : "Record up to 45 seconds, then review before submission."}</Text>
            <Pressable onPress={isRecording ? stop : record} style={({ pressed }) => [isRecording ? styles.stopButton : styles.recordButton, pressed && styles.pressed]}>
              <View style={isRecording ? styles.stopSymbol : styles.recordSymbol} />
              <Text style={styles.recordButtonText}>{isRecording ? "Stop recording" : "Start recording"}</Text>
            </Pressable>
            {message ? <Text style={styles.errorText}>{message}</Text> : null}
          </View>
        </View>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: "#102A43" },
  permissionContent: { flex: 1, justifyContent: "center", padding: 24, gap: 15 },
  permissionIcon: { width: 62, height: 62, borderRadius: 20, backgroundColor: "#E6FFFB", alignItems: "center", justifyContent: "center" },
  permissionIconText: { color: "#0F766E", fontSize: 35, fontWeight: "800" },
  permissionTitle: { color: "#102A43", fontSize: 30, lineHeight: 37, fontWeight: "700", marginTop: 6 },
  permissionText: { color: "#486581", fontSize: 16, lineHeight: 24, marginBottom: 8 },
  primaryButton: { minHeight: 54, backgroundColor: "#0F766E", borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", textAlign: "center" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#486581", fontSize: 16, fontWeight: "600" },
  overlay: { flex: 1, justifyContent: "space-between", padding: 16 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(16,42,67,0.66)" },
  iconButtonText: { color: "#FFFFFF", fontSize: 31, fontWeight: "300", marginTop: -3 },
  iconSpacer: { width: 42 },
  captureBadge: { backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  captureBadgeText: { color: "#102A43", fontSize: 13, fontWeight: "700" },
  frameWrap: { alignItems: "center", gap: 12, marginTop: 24 },
  frame: { width: "86%", aspectRatio: 0.78, borderRadius: 28, borderWidth: 2, borderColor: "rgba(230,255,251,0.92)", borderStyle: "dashed" },
  frameText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", backgroundColor: "rgba(16,42,67,0.64)", borderRadius: 999, overflow: "hidden", paddingHorizontal: 12, paddingVertical: 7 },
  controlCard: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 23, padding: 20, gap: 7 },
  controlTitle: { color: "#102A43", fontSize: 20, fontWeight: "700" },
  controlText: { color: "#486581", fontSize: 14, lineHeight: 20, marginBottom: 6 },
  recordButton: { minHeight: 54, borderRadius: 16, backgroundColor: "#0F766E", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  stopButton: { minHeight: 54, borderRadius: 16, backgroundColor: "#B91C1C", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  recordSymbol: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#FFFFFF" },
  stopSymbol: { width: 15, height: 15, borderRadius: 3, backgroundColor: "#FFFFFF" },
  recordButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  errorText: { color: "#B91C1C", fontSize: 13, lineHeight: 18, marginTop: 3 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#486581", fontSize: 15 },
});
