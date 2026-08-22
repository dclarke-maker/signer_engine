import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import type { FeedbackVote } from "@/shared/workflow";

export default function FeedbackScreen() {
  const { evaluationId } = useLocalSearchParams<{ evaluationId: string }>();
  const [selectedVote, setSelectedVote] = useState<FeedbackVote | null>(null);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const submitFeedback = trpc.feedback.submit.useMutation();

  const choose = (vote: FeedbackVote) => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedVote(vote);
  };

  const submit = async () => {
    if (!selectedVote) return;
    try {
      await submitFeedback.mutateAsync({
        evaluationId: evaluationId || "initial-fixture",
        vote: selectedVote,
        note: note.trim() || undefined,
        createdAt: new Date().toISOString(),
      });
      if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch {
      // Preserve the selected verdict and optional note so the participant can retry.
    }
  };

  if (submitted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.submitted}>
          <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
          <Text style={styles.title}>Feedback recorded</Text>
          <Text style={styles.subtitle}>Your evaluation helps measure interpretation accuracy for this workflow.</Text>
          <Pressable onPress={() => router.replace("/")} style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}>
            <Text style={styles.submitButtonText}>Return to workspace</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.content}>
        <View style={styles.topCopy}>
          <Text style={styles.title}>How accurate was it?</Text>
          <Text style={styles.subtitle}>
            Compare the English response with the signing sample and select the closest result.
          </Text>
        </View>

        <View style={styles.voteGroup}>
          <Pressable onPress={() => choose("accurate")} style={({ pressed }) => [styles.voteCard, selectedVote === "accurate" && styles.voteCardSelected, pressed && styles.pressed]}>
            <Text style={styles.voteIcon}>✓</Text>
            <View style={styles.voteCopy}><Text style={styles.voteTitle}>Accurate</Text><Text style={styles.voteText}>The English response matches the signer's intent.</Text></View>
          </Pressable>
          <Pressable onPress={() => choose("needs_correction")} style={({ pressed }) => [styles.voteCard, selectedVote === "needs_correction" && styles.voteCardCorrection, pressed && styles.pressed]}>
            <Text style={styles.voteIcon}>↗</Text>
            <View style={styles.voteCopy}><Text style={styles.voteTitle}>Needs correction</Text><Text style={styles.voteText}>The response is incomplete, incorrect, or unclear.</Text></View>
          </Pressable>
        </View>

        <View style={styles.noteBlock}>
          <Text style={styles.noteLabel}>Optional note</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={280}
            placeholder="Describe what should be improved"
            placeholderTextColor="#829AB1"
            style={styles.input}
            textAlignVertical="top"
            returnKeyType="done"
          />
        </View>

        <View style={styles.bottomAction}>
          <Pressable disabled={!selectedVote || submitFeedback.isPending} onPress={submit} style={({ pressed }) => [styles.submitButton, (!selectedVote || submitFeedback.isPending) && styles.disabledButton, pressed && selectedVote && styles.pressed]}>
            <Text style={styles.submitButtonText}>{submitFeedback.isPending ? "Submitting…" : "Submit feedback"}</Text>
          </Pressable>
          <Text style={styles.smallPrint}>Evaluation reference: {evaluationId || "pending"}</Text>
          {submitFeedback.isError ? <Text style={styles.errorText}>Feedback could not be sent. Please check your connection and retry.</Text> : null}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20, gap: 22 },
  topCopy: { gap: 8 },
  title: { color: "#102A43", fontSize: 29, lineHeight: 36, fontWeight: "700" },
  subtitle: { color: "#486581", fontSize: 16, lineHeight: 23 },
  voteGroup: { gap: 12 },
  voteCard: { minHeight: 92, borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D9E2EC", padding: 17, flexDirection: "row", alignItems: "center", gap: 14 },
  voteCardSelected: { backgroundColor: "#ECFDF5", borderColor: "#15803D", borderWidth: 2 },
  voteCardCorrection: { backgroundColor: "#FFF7ED", borderColor: "#B45309", borderWidth: 2 },
  voteIcon: { color: "#0F766E", fontSize: 27, fontWeight: "700", width: 28, textAlign: "center" },
  voteCopy: { flex: 1, gap: 3 },
  voteTitle: { color: "#102A43", fontSize: 17, fontWeight: "700" },
  voteText: { color: "#486581", fontSize: 13, lineHeight: 18 },
  noteBlock: { gap: 8 },
  noteLabel: { color: "#334E68", fontSize: 14, fontWeight: "700" },
  input: { minHeight: 105, borderRadius: 16, borderWidth: 1, borderColor: "#9FB3C8", padding: 14, color: "#102A43", fontSize: 15, lineHeight: 21 },
  bottomAction: { marginTop: "auto", gap: 9 },
  submitButton: { minHeight: 54, borderRadius: 16, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center" },
  disabledButton: { backgroundColor: "#9FB3C8" },
  submitButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  smallPrint: { color: "#829AB1", fontSize: 12, textAlign: "center" },
  errorText: { color: "#B91C1C", fontSize: 13, textAlign: "center" },
  submitted: { flex: 1, padding: 24, justifyContent: "center", alignItems: "center", gap: 15 },
  check: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" },
  checkText: { color: "#15803D", fontSize: 38, fontWeight: "700" },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
