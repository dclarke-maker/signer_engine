import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import type { FeedbackVote } from "@/shared/workflow";

const SCALES = [
  { key: "naturalness", label: "Natural", low: "Stilted", high: "Natural" },
  { key: "grammaticality", label: "Grammatical", low: "Wrong", high: "Correct" },
  { key: "usefulness", label: "Useful", low: "Useless", high: "Useful" },
] as const;

type ScaleKey = (typeof SCALES)[number]["key"];

export default function FeedbackScreen() {
  const { translationJobId, englishResponse } = useLocalSearchParams<{
    translationJobId?: string;
    englishResponse?: string;
  }>();

  const [vote, setVote] = useState<FeedbackVote | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<ScaleKey, number>>>({});
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitVote = trpc.feedback.submit.useMutation();
  const submitRating = trpc.feedback.rate.useMutation();
  const pending = submitVote.isPending || submitRating.isPending;

  const choose = (next: FeedbackVote) => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setVote(next);
  };

  const setScale = (key: ScaleKey, value: number) => {
    if (Platform.OS !== "web") void Haptics.selectionAsync();
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const allRated = SCALES.every((s) => ratings[s.key] !== undefined);

  const submit = async () => {
    if (!vote || !translationJobId) return;
    setError(null);
    try {
      // The directional vote is the required signal. Ratings are optional and
      // sent only when complete, so an unfinished scale never blocks the vote.
      await submitVote.mutateAsync({
        translationJobId,
        vote,
        note: note.trim() || undefined,
      });
      if (allRated) {
        await submitRating.mutateAsync({
          translationJobId,
          naturalness: ratings.naturalness!,
          grammaticality: ratings.grammaticality!,
          usefulness: ratings.usefulness!,
        });
      }
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your feedback could not be recorded.");
    }
  };

  if (submitted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.done}>
          <View style={styles.check}>
            <Text style={styles.checkText}>✓</Text>
          </View>
          <Text style={styles.title}>Feedback recorded</Text>
          <Text style={styles.body}>
            Your judgement helps measure how accurate the interpretations really are.
          </Text>
          <Pressable
            onPress={() => router.replace("/live-translate")}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Sign something else</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/")}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>Return to workspace</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>How accurate was it?</Text>
          {englishResponse ? <Text style={styles.quote}>“{englishResponse}”</Text> : null}

          <View style={styles.voteGroup}>
            <Pressable
              onPress={() => choose("accurate")}
              style={({ pressed }) => [
                styles.voteCard,
                vote === "accurate" && styles.voteCardAccurate,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.voteIcon}>✓</Text>
              <View style={styles.voteCopy}>
                <Text style={styles.voteTitle}>Accurate</Text>
                <Text style={styles.voteText}>The English matches what I signed.</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => choose("needs_correction")}
              style={({ pressed }) => [
                styles.voteCard,
                vote === "needs_correction" && styles.voteCardCorrection,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.voteIcon}>↗</Text>
              <View style={styles.voteCopy}>
                <Text style={styles.voteTitle}>Needs correction</Text>
                <Text style={styles.voteText}>It is incomplete, incorrect, or unclear.</Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.scalesBlock}>
            <Text style={styles.scalesTitle}>Rate the response (optional)</Text>
            {SCALES.map((scale) => (
              <View key={scale.key} style={styles.scale}>
                <Text style={styles.scaleLabel}>{scale.label}</Text>
                <View style={styles.scaleRow}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => setScale(scale.key, value)}
                      style={({ pressed }) => [
                        styles.scaleDot,
                        ratings[scale.key] === value && styles.scaleDotSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.scaleDotText,
                          ratings[scale.key] === value && styles.scaleDotTextSelected,
                        ]}
                      >
                        {value}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.scaleEnds}>
                  <Text style={styles.scaleEndText}>{scale.low}</Text>
                  <Text style={styles.scaleEndText}>{scale.high}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.noteBlock}>
            <Text style={styles.noteLabel}>Optional note</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={280}
              placeholder="What should it have said?"
              placeholderTextColor="#829AB1"
              style={styles.noteInput}
            />
          </View>
        </ScrollView>

        <View style={styles.actions}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            disabled={!vote || pending}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              (!vote || pending) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {pending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Submit feedback</Text>
            )}
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 20, gap: 18 },
  title: { color: "#102A43", fontSize: 28, lineHeight: 35, fontWeight: "700" },
  quote: { color: "#7C2D12", fontSize: 17, lineHeight: 25, fontStyle: "italic" },
  voteGroup: { gap: 11 },
  voteCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 76,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#D9E2EC",
    backgroundColor: "#FFFFFF",
    padding: 16,
  },
  voteCardAccurate: { borderColor: "#15803D", backgroundColor: "#DCFCE7" },
  voteCardCorrection: { borderColor: "#B45309", backgroundColor: "#FFF7ED" },
  voteIcon: { color: "#102A43", fontSize: 22, fontWeight: "800" },
  voteCopy: { flex: 1, gap: 3 },
  voteTitle: { color: "#102A43", fontSize: 17, fontWeight: "700" },
  voteText: { color: "#486581", fontSize: 14, lineHeight: 20 },
  scalesBlock: { gap: 15 },
  scalesTitle: { color: "#102A43", fontSize: 17, fontWeight: "700" },
  scale: { gap: 7 },
  scaleLabel: { color: "#334E68", fontSize: 14, fontWeight: "700" },
  scaleRow: { flexDirection: "row", gap: 9 },
  scaleDot: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#9FB3C8",
    alignItems: "center",
    justifyContent: "center",
  },
  scaleDotSelected: { backgroundColor: "#0F766E", borderColor: "#0F766E" },
  scaleDotText: { color: "#334E68", fontSize: 16, fontWeight: "700" },
  scaleDotTextSelected: { color: "#FFFFFF" },
  scaleEnds: { flexDirection: "row", justifyContent: "space-between" },
  scaleEndText: { color: "#829AB1", fontSize: 12 },
  noteBlock: { gap: 7 },
  noteLabel: { color: "#334E68", fontSize: 14, fontWeight: "700" },
  noteInput: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: "#9FB3C8",
    borderRadius: 15,
    padding: 14,
    color: "#102A43",
    fontSize: 16,
    textAlignVertical: "top",
  },
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
  disabled: { opacity: 0.6 },
  errorText: { color: "#B91C1C", fontSize: 14, lineHeight: 20 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  done: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 13 },
  check: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { color: "#15803D", fontSize: 42, fontWeight: "700" },
  body: {
    color: "#486581",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    maxWidth: 320,
    marginBottom: 8,
  },
});
