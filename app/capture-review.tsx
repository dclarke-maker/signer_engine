import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
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
import { clearCaptureBuffer, takeCaptureBuffer } from "@/lib/capture-buffer";
import { TARGET_FPS, getExtractor } from "@/lib/extractors";
import { formatElapsed } from "@/lib/format-elapsed";
import { uploadSequence } from "@/lib/upload-sequence";
import { trpc } from "@/lib/trpc";
import type { CorpusCategory } from "@/shared/corpus";
import type { LandmarkFrame } from "@/shared/landmarks";

type StreamKey = "leftHand" | "rightHand" | "face" | "pose";

const STREAM_LABEL: Record<StreamKey, string> = {
  leftHand: "Left hand",
  rightHand: "Right hand",
  face: "Face",
  pose: "Body",
};

function coverageOf(frames: LandmarkFrame[], key: StreamKey): number {
  if (frames.length === 0) return 0;
  return frames.filter((f) => f[key] !== null).length / frames.length;
}

export default function CaptureReviewScreen() {
  const params = useLocalSearchParams<{
    sessionId?: string;
    text?: string;
    nepali?: string;
    frameCount?: string;
    durationMs?: string;
    achievedFps?: string;
  }>();

  const utils = trpc.useUtils();
  // Drained once on mount: the buffer is the only place these frames exist.
  const [frames] = useState<LandmarkFrame[]>(() => takeCaptureBuffer());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionQuery = trpc.capture.session.useQuery(
    { sessionId: params.sessionId ?? "" },
    { enabled: !!params.sessionId },
  );

  const durationMs = Number(params.durationMs ?? 0);
  const achievedFps = Number(params.achievedFps ?? 0);
  const frameCount = frames.length || Number(params.frameCount ?? 0);

  const coverage = useMemo(
    () =>
      (["leftHand", "rightHand", "face", "pose"] as StreamKey[]).map((key) => ({
        key,
        value: coverageOf(frames, key),
      })),
    [frames],
  );

  const submit = async () => {
    if (!params.sessionId || frames.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await uploadSequence({
        schemaVersion: 1,
        sessionId: params.sessionId,
        promptId: sessionQuery.data?.promptId ?? "",
        category: (sessionQuery.data?.category ?? "declarative") as CorpusCategory,
        extractorId: getExtractor().id,
        targetFps: TARGET_FPS,
        achievedFps,
        frameCount,
        durationMs,
        frames,
      });
      clearCaptureBuffer();
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await utils.capture.nextPrompt.invalidate();
      await utils.capture.progress.invalidate();
      router.replace("/prompt-session");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sequence could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  const discard = () => {
    clearCaptureBuffer();
    router.replace("/prompt-session");
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Check your sample</Text>
          {params.nepali ? <Text style={styles.promptNepali}>{params.nepali}</Text> : null}
          {params.text ? <Text style={styles.prompt}>“{params.text}”</Text> : null}

          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Motion sequence</Text>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{frameCount}</Text>
                <Text style={styles.statLabel}>frames</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatElapsed(durationMs)}</Text>
                <Text style={styles.statLabel}>duration</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{achievedFps}</Text>
                <Text style={styles.statLabel}>fps</Text>
              </View>
            </View>
          </View>

          <View style={styles.coverageCard}>
            <Text style={styles.cardTitle}>What stayed in frame</Text>
            {coverage.map(({ key, value }) => (
              <View key={key} style={styles.coverageRow}>
                <Text style={styles.coverageLabel}>{STREAM_LABEL[key]}</Text>
                <View style={styles.coverageTrack}>
                  <View
                    style={[
                      styles.coverageFill,
                      { width: `${Math.round(value * 100)}%` },
                      value < 0.5 && styles.coverageFillLow,
                    ]}
                  />
                </View>
                <Text style={styles.coveragePercent}>{Math.round(value * 100)}%</Text>
              </View>
            ))}
            <Text style={styles.coverageHint}>
              Low coverage usually means part of you drifted out of the frame. Record again if it
              looks wrong.
            </Text>
          </View>

          <Text style={styles.privacy}>
            No video exists on this device. Submitting sends only these motion points, the sentence,
            and its category.
          </Text>
        </ScrollView>

        <View style={styles.actions}>
          {frames.length === 0 ? (
            <Text style={styles.errorText}>
              This sample has already been submitted or discarded. Record again to continue.
            </Text>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            disabled={submitting || frames.length === 0}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              (submitting || frames.length === 0) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Submit sample</Text>
            )}
          </Pressable>
          <Pressable
            onPress={discard}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>Discard and record again</Text>
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 20, gap: 16 },
  title: { color: "#102A43", fontSize: 28, lineHeight: 35, fontWeight: "700" },
  promptNepali: { color: "#102A43", fontSize: 20, lineHeight: 30, fontWeight: "600" },
  prompt: { color: "#486581", fontSize: 15, lineHeight: 22, fontStyle: "italic" },
  summaryCard: { backgroundColor: "#102A43", borderRadius: 22, padding: 20, gap: 14 },
  summaryLabel: {
    color: "#9FB3C8",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  statRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", gap: 3, flex: 1 },
  statValue: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  statLabel: { color: "#D9E2EC", fontSize: 13 },
  coverageCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#D9E2EC",
    gap: 11,
  },
  cardTitle: { color: "#102A43", fontSize: 17, fontWeight: "700" },
  coverageRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  coverageLabel: { color: "#334E68", fontSize: 14, width: 86 },
  coverageTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#D9E2EC",
    overflow: "hidden",
  },
  coverageFill: { height: 8, borderRadius: 999, backgroundColor: "#15803D" },
  coverageFillLow: { backgroundColor: "#B45309" },
  coveragePercent: { color: "#334E68", fontSize: 13, fontWeight: "700", width: 42, textAlign: "right" },
  coverageHint: { color: "#627D98", fontSize: 13, lineHeight: 19, marginTop: 2 },
  privacy: { color: "#627D98", fontSize: 13, lineHeight: 19 },
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
  errorText: { color: "#B91C1C", fontSize: 14, lineHeight: 20 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
