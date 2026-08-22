import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { TARGET_FPS, getExtractor } from "@/lib/extractors";
import { formatElapsed } from "@/lib/format-elapsed";
import { uploadSequence } from "@/lib/upload-sequence";
import { trpc } from "@/lib/trpc";
import type { LandmarkFrame } from "@/shared/landmarks";

type Phase = "idle" | "signing" | "processing" | "result";

export default function LiveTranslateScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<{
    jobId: string;
    englishResponse: string;
    confidence: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const framesRef = useRef<LandmarkFrame[]>([]);
  const extractorRef = useRef(getExtractor());
  const startedAtRef = useRef(0);

  const signerQuery = trpc.signer.me.useQuery();
  const startSession = trpc.capture.startSession.useMutation();
  const requestTranslation = trpc.translation.request.useMutation();

  useEffect(() => {
    if (!signerQuery.isLoading && !signerQuery.data) router.replace("/sign-in");
  }, [signerQuery.data, signerQuery.isLoading]);

  useEffect(() => {
    if (phase !== "signing") return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
    return () => clearInterval(id);
  }, [phase]);

  const begin = async () => {
    setError(null);
    setResult(null);
    framesRef.current = [];
    setElapsedMs(0);
    startedAtRef.current = Date.now();
    const extractor = extractorRef.current;
    await extractor.start({ targetFps: TARGET_FPS });
    extractor.subscribe((frame) => framesRef.current.push(frame));
    setPhase("signing");
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const finish = async () => {
    setPhase("processing");
    setError(null);
    try {
      const summary = await extractorRef.current.stop();
      const frames = framesRef.current;
      framesRef.current = [];

      // A live translation still runs through a capture session, so the
      // sequence, its interpretation, and the feedback stay linked for export.
      const session = await startSession.mutateAsync({ promptId: "A-01" });
      await uploadSequence({
        schemaVersion: 1,
        sessionId: session.id,
        promptId: session.promptId,
        category: session.category,
        extractorId: extractorRef.current.id,
        targetFps: TARGET_FPS,
        achievedFps: Math.round(summary.achievedFps),
        frameCount: summary.frameCount,
        durationMs: summary.durationMs,
        frames,
      });

      const job = await requestTranslation.mutateAsync({
        sessionId: session.id,
        frameCount: summary.frameCount,
      });
      setResult({
        jobId: job.id,
        englishResponse: job.englishResponse,
        confidence: job.confidence,
      });
      setPhase("result");
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The translation could not be produced.");
      setPhase("idle");
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
            SignBridge reads motion points from the camera. No video is recorded or saved.
          </Text>
          <Pressable
            onPress={requestPermission}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Allow camera</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (phase === "result" && result) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.wrap}>
          <ScrollView contentContainerStyle={styles.resultContent}>
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>Translation phase</Text>
            </View>
            <Text style={styles.title}>Review the English response</Text>

            <View style={styles.responseCard}>
              <Text style={styles.responseLabel}>English interpretation</Text>
              <Text style={styles.responseText}>“{result.englishResponse}”</Text>
              <Text style={styles.disclaimer}>
                This is an automated response, not a verified translation. Please judge it against
                what you signed.
              </Text>
            </View>

            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>Model confidence</Text>
              <Text style={styles.confidenceValue}>{Math.round(result.confidence * 100)}%</Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/feedback",
                  params: {
                    translationJobId: result.jobId,
                    englishResponse: result.englishResponse,
                  },
                } as never)
              }
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>Rate this interpretation</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setResult(null);
                setPhase("idle");
              }}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>Sign something else</Text>
            </Pressable>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.fullScreen}>
      <CameraView style={StyleSheet.absoluteFill} facing="front" />
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
            <View style={styles.privacyBadge}>
              <Text style={styles.privacyBadgeText}>
                {phase === "signing"
                  ? `Reading motion points ${formatElapsed(elapsedMs)}`
                  : "No video is saved"}
              </Text>
            </View>
            <View style={styles.iconSpacer} />
          </View>

          <View style={styles.frameWrap}>
            <View style={styles.frame} />
            <Text style={styles.frameText}>Keep hands, face, and upper body in view</Text>
          </View>

          <View style={styles.controlCard}>
            <Text style={styles.controlTitle}>
              {phase === "processing" ? "Interpreting…" : "Sign into the camera"}
            </Text>
            <Text style={styles.controlText}>
              {phase === "processing"
                ? "Your motion points are being interpreted."
                : "Sign naturally, then stop to see the English response."}
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              disabled={phase === "processing"}
              onPress={phase === "signing" ? finish : begin}
              style={({ pressed }) => [
                phase === "signing" ? styles.stopButton : styles.recordButton,
                phase === "processing" && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {phase === "processing" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <View style={phase === "signing" ? styles.stopSymbol : styles.recordSymbol} />
                  <Text style={styles.recordButtonText}>
                    {phase === "signing" ? "Stop and translate" : "Start signing"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: "#102A43" },
  wrap: { flex: 1 },
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
  permissionTitle: { color: "#102A43", fontSize: 30, fontWeight: "700", marginTop: 6 },
  permissionText: { color: "#486581", fontSize: 16, lineHeight: 24, marginBottom: 8 },
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
  controlCard: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 23, padding: 20, gap: 7 },
  controlTitle: { color: "#102A43", fontSize: 20, fontWeight: "700" },
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
  resultContent: { padding: 20, gap: 16 },
  eyebrowRow: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#E6FFFB",
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  eyebrow: { color: "#0F766E", fontSize: 13, fontWeight: "700" },
  title: { color: "#102A43", fontSize: 30, lineHeight: 37, fontWeight: "700" },
  responseCard: { backgroundColor: "#FFF7ED", borderRadius: 22, padding: 21, gap: 11 },
  responseLabel: {
    color: "#B45309",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  responseText: { color: "#7C2D12", fontSize: 23, lineHeight: 32, fontWeight: "600" },
  disclaimer: { color: "#9A3412", fontSize: 13, lineHeight: 19 },
  confidenceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  confidenceLabel: { color: "#486581", fontSize: 15 },
  confidenceValue: { color: "#102A43", fontSize: 17, fontWeight: "700" },
  actions: {
    padding: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#D9E2EC",
    backgroundColor: "#FFFFFF",
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#486581", fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.65 },
  errorText: { color: "#B91C1C", fontSize: 13, lineHeight: 19 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
