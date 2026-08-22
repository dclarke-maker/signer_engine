import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { LandmarkCamera } from "@/components/landmark-camera";
import { ScreenContainer } from "@/components/screen-container";
import { setCaptureBuffer } from "@/lib/capture-buffer";
import { TARGET_FPS, getExtractor } from "@/lib/extractors";
import { formatElapsed } from "@/lib/format-elapsed";
import type { LandmarkFrame } from "@/shared/landmarks";

export default function CaptureScreen() {
  const { sessionId, text } = useLocalSearchParams<{
    sessionId?: string;
    promptId?: string;
    text?: string;
  }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const framesRef = useRef<LandmarkFrame[]>([]);
  const extractorRef = useRef(getExtractor());
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!isCapturing) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
    return () => clearInterval(id);
  }, [isCapturing]);

  const begin = async () => {
    setMessage(null);
    framesRef.current = [];
    setFrameCount(0);
    setElapsedMs(0);
    startedAtRef.current = Date.now();

    const extractor = extractorRef.current;
    try {
      await extractor.start({ targetFps: TARGET_FPS });
      extractor.subscribe((frame) => {
        framesRef.current.push(frame);
        setFrameCount(framesRef.current.length);
      });
      setIsCapturing(true);
      if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      setMessage("The camera could not be read. Please check permissions and try again.");
    }
  };

  const finish = async () => {
    const extractor = extractorRef.current;
    try {
      const summary = await extractor.stop();
      setIsCapturing(false);
      // Frames go to a process-local buffer, never into navigation state.
      setCaptureBuffer(framesRef.current);
      framesRef.current = [];
      if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.replace({
        pathname: "/capture-review",
        params: {
          sessionId: sessionId ?? "",
          text: text ?? "",
          frameCount: String(summary.frameCount),
          durationMs: String(summary.durationMs),
          achievedFps: String(Math.round(summary.achievedFps)),
        },
      } as never);
    } catch {
      setIsCapturing(false);
      setMessage("The capture could not be completed. Please try again.");
    }
  };

  if (!permission?.granted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.permissionContent}>
          <View style={styles.permissionIcon}>
            <Text style={styles.permissionIconText}>⌁</Text>
          </View>
          <Text style={styles.permissionTitle}>Camera access</Text>
          <Text style={styles.permissionText}>
            SignBridge reads motion points from the camera. No video is recorded or saved — camera
            images stay on this device and are discarded immediately.
          </Text>
          <Pressable
            onPress={requestPermission}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Allow camera</Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.fullScreen}>
      <LandmarkCamera extractor={extractorRef.current} active={isCapturing} />
      <ScreenContainer
        edges={["top", "bottom", "left", "right"]}
        containerClassName="bg-transparent"
        safeAreaClassName="bg-transparent"
      >
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Text style={styles.iconButtonText}>×</Text>
            </Pressable>
            {isCapturing ? (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Reading motion points {formatElapsed(elapsedMs)}</Text>
              </View>
            ) : (
              <View style={styles.privacyBadge}>
                <Text style={styles.privacyBadgeText}>No video is saved</Text>
              </View>
            )}
            <View style={styles.iconSpacer} />
          </View>

          <View style={styles.frameWrap}>
            <View style={styles.frame} />
            <Text style={styles.frameText}>Keep hands, face, and upper body in view</Text>
          </View>

          <View style={styles.controlCard}>
            {text ? <Text style={styles.promptText}>{text}</Text> : null}
            <Text style={styles.controlText}>
              {isCapturing
                ? `${frameCount} motion frames read. Tap stop when you finish.`
                : "Sign at your natural pace. Nothing is recorded — only motion points."}
            </Text>
            <Pressable
              onPress={isCapturing ? finish : begin}
              style={({ pressed }) => [
                isCapturing ? styles.stopButton : styles.recordButton,
                pressed && styles.pressed,
              ]}
            >
              <View style={isCapturing ? styles.stopSymbol : styles.recordSymbol} />
              <Text style={styles.recordButtonText}>
                {isCapturing ? "Stop and review" : "Start signing"}
              </Text>
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
  permissionIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: "#E6FFFB",
    alignItems: "center",
    justifyContent: "center",
  },
  permissionIconText: { color: "#0F766E", fontSize: 35, fontWeight: "800" },
  permissionTitle: {
    color: "#102A43",
    fontSize: 30,
    lineHeight: 37,
    fontWeight: "700",
    marginTop: 6,
  },
  permissionText: { color: "#486581", fontSize: 16, lineHeight: 24, marginBottom: 8 },
  primaryButton: {
    minHeight: 54,
    backgroundColor: "#0F766E",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", textAlign: "center" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#486581", fontSize: 16, fontWeight: "600" },
  overlay: { flex: 1, justifyContent: "space-between", padding: 16 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16,42,67,0.66)",
  },
  iconButtonText: { color: "#FFFFFF", fontSize: 31, fontWeight: "300", marginTop: -3 },
  iconSpacer: { width: 42 },
  privacyBadge: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  privacyBadgeText: { color: "#102A43", fontSize: 13, fontWeight: "700" },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#0F766E" },
  liveText: { color: "#102A43", fontSize: 13, fontWeight: "700" },
  frameWrap: { alignItems: "center", gap: 12, marginTop: 24 },
  frame: {
    width: "86%",
    aspectRatio: 0.78,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(230,255,251,0.92)",
    borderStyle: "dashed",
  },
  frameText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    backgroundColor: "rgba(16,42,67,0.64)",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  controlCard: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 23, padding: 20, gap: 8 },
  promptText: { color: "#102A43", fontSize: 20, lineHeight: 27, fontWeight: "700" },
  controlText: { color: "#486581", fontSize: 14, lineHeight: 20, marginBottom: 6 },
  recordButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: "#0F766E",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  stopButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: "#B45309",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  recordSymbol: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#FFFFFF" },
  stopSymbol: { width: 15, height: 15, borderRadius: 3, backgroundColor: "#FFFFFF" },
  recordButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  errorText: { color: "#B91C1C", fontSize: 13, lineHeight: 18, marginTop: 3 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
