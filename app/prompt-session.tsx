import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
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
import { CATEGORY_PURPOSE, type CorpusCategory } from "@/shared/corpus";
import { trpc } from "@/lib/trpc";

const CATEGORY_LABEL: Record<CorpusCategory, string> = {
  declarative: "Statement",
  interrogative: "Question",
  negation: "Negation",
  temporal: "Time",
  utility: "Everyday",
};

export default function PromptSessionScreen() {
  const utils = trpc.useUtils();
  const signerQuery = trpc.signer.me.useQuery();
  const consentQuery = trpc.consent.status.useQuery();
  const promptQuery = trpc.capture.nextPrompt.useQuery(undefined, { enabled: !!signerQuery.data });
  const startSession = trpc.capture.startSession.useMutation();
  const skip = trpc.capture.skipPrompt.useMutation();

  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!signerQuery.isLoading && !signerQuery.data) router.replace("/sign-in");
  }, [signerQuery.data, signerQuery.isLoading]);

  useEffect(() => {
    if (!consentQuery.isLoading && consentQuery.data && !consentQuery.data.granted) {
      router.replace("/consent");
    }
  }, [consentQuery.data, consentQuery.isLoading]);

  const prompt = promptQuery.data;

  const start = async () => {
    if (!prompt) return;
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const session = await startSession.mutateAsync({ promptId: prompt.id });
    router.push({
      pathname: "/capture",
      params: { sessionId: session.id, promptId: prompt.id, text: prompt.textEnglish },
    } as never);
  };

  const confirmSkip = async () => {
    if (!prompt) return;
    await skip.mutateAsync({ promptId: prompt.id, reason: reason.trim() || "not given" });
    setSkipping(false);
    setReason("");
    await utils.capture.nextPrompt.invalidate();
    await utils.capture.progress.invalidate();
  };

  if (signerQuery.isLoading || consentQuery.isLoading || promptQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.loading}>
          <ActivityIndicator color="#0F766E" />
          <Text style={styles.loadingText}>Loading your next sentence…</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!prompt) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.done}>
          <View style={styles.check}>
            <Text style={styles.checkText}>✓</Text>
          </View>
          <Text style={styles.title}>Every sentence is done</Text>
          <Text style={styles.body}>
            You have worked through the whole set. Thank you for contributing to this research.
          </Text>
          <Pressable
            onPress={() => router.replace("/")}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Return to workspace</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const { completed, total } = prompt.progress;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              Sentence {completed + 1} of {total}
            </Text>
            <View style={styles.categoryPill}>
              <Text style={styles.categoryPillText}>{CATEGORY_LABEL[prompt.category]}</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>

          <View style={styles.promptCard}>
            <Text style={styles.promptLabel}>Sign this sentence</Text>
            <Text style={styles.promptText}>{prompt.textEnglish}</Text>
            <Text style={styles.promptPurpose}>{CATEGORY_PURPOSE[prompt.category]}</Text>
          </View>

          <View style={styles.guidance}>
            <Text style={styles.guidanceTitle}>Before you start</Text>
            <Text style={styles.guidanceText}>
              Keep your hands, face, and upper body in the frame. Sign at your natural pace. Your
              camera is never recorded — only motion points leave this device.
            </Text>
          </View>
        </ScrollView>

        {skipping ? (
          <View style={styles.actions}>
            <Text style={styles.skipLabel}>Why are you skipping this sentence?</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Optional — e.g. unfamiliar sign, poor lighting"
              placeholderTextColor="#829AB1"
              maxLength={256}
              style={styles.input}
            />
            <Pressable
              disabled={skip.isPending}
              onPress={confirmSkip}
              style={({ pressed }) => [
                styles.primaryButton,
                skip.isPending && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Skip this sentence</Text>
            </Pressable>
            <Pressable
              onPress={() => setSkipping(false)}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.actions}>
            {startSession.isError ? (
              <Text style={styles.errorText}>
                The session could not be started. Please try again.
              </Text>
            ) : null}
            <Pressable
              disabled={startSession.isPending}
              onPress={start}
              style={({ pressed }) => [
                styles.primaryButton,
                startSession.isPending && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {startSession.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Start signing</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setSkipping(true)}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>Skip this sentence</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 20, gap: 16 },
  progressRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progressText: { color: "#334E68", fontSize: 15, fontWeight: "700" },
  categoryPill: {
    borderRadius: 999,
    backgroundColor: "#E6FFFB",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryPillText: { color: "#0F766E", fontSize: 13, fontWeight: "700" },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: "#D9E2EC", overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: "#0F766E" },
  promptCard: { backgroundColor: "#E6FFFB", borderRadius: 24, padding: 22, gap: 10, marginTop: 6 },
  promptLabel: {
    color: "#0F766E",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  promptText: { color: "#102A43", fontSize: 28, lineHeight: 36, fontWeight: "700" },
  promptPurpose: { color: "#486581", fontSize: 14, lineHeight: 20 },
  guidance: { gap: 7, marginTop: 2 },
  guidanceTitle: { color: "#102A43", fontSize: 17, fontWeight: "700" },
  guidanceText: { color: "#486581", fontSize: 15, lineHeight: 22 },
  actions: {
    padding: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#D9E2EC",
    backgroundColor: "#FFFFFF",
  },
  skipLabel: { color: "#334E68", fontSize: 14, fontWeight: "700" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#9FB3C8",
    borderRadius: 15,
    paddingHorizontal: 14,
    color: "#102A43",
    fontSize: 16,
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
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#486581", fontSize: 15 },
  done: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  check: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { color: "#15803D", fontSize: 42, fontWeight: "700" },
  title: { color: "#102A43", fontSize: 28, fontWeight: "700", textAlign: "center" },
  body: { color: "#486581", fontSize: 16, lineHeight: 24, textAlign: "center", maxWidth: 320 },
});
