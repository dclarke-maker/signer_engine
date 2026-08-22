import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

const GUARANTEES = [
  "No facial images are stored or transmitted.",
  "No personally identifiable visual data is retained.",
  "Anonymisation happens on this device, before anything is sent.",
  "Only the motion points needed for the research are collected.",
];

export default function ConsentScreen() {
  const utils = trpc.useUtils();
  const statusQuery = trpc.consent.status.useQuery();
  const grant = trpc.consent.grant.useMutation();
  const [failed, setFailed] = useState(false);

  const agree = async () => {
    setFailed(false);
    try {
      await grant.mutateAsync({
        consentVersion: statusQuery.data?.consentVersion ?? "v1",
        scopes: ["participation"],
      });
      await utils.consent.status.invalidate();
      router.replace("/prompt-session");
    } catch {
      setFailed(true);
    }
  };

  if (statusQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.loading}>
          <ActivityIndicator color="#0F766E" />
          <Text style={styles.loadingText}>Checking your consent status…</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Research consent</Text>
          </View>
          <Text style={styles.title}>Taking part in this study</Text>
          <Text style={styles.body}>
            This study is building a Nepali Sign Language translation system with the National
            Federation of the Deaf Nepal. You will be shown sentences to sign, one at a time.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>What is collected</Text>
            <Text style={styles.cardBody}>
              While you sign, this device measures the position of your hands, face, and upper body
              and turns them into numbers. Only those numbers are sent, together with the sentence
              you were given and its category.
            </Text>
          </View>

          <View style={[styles.card, styles.assuranceCard]}>
            <Text style={styles.cardTitle}>What is never collected</Text>
            <Text style={styles.cardBody}>
              No video is recorded and no video is saved. Camera images stay in memory on this
              device for a fraction of a second and are then discarded.
            </Text>
            {GUARANTEES.map((line) => (
              <View key={line} style={styles.guaranteeRow}>
                <Text style={styles.tick}>✓</Text>
                <Text style={styles.guaranteeText}>{line}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your choice</Text>
            <Text style={styles.cardBody}>
              Taking part is voluntary. You can skip any sentence, stop at any time, and withdraw
              your consent from Settings. Withdrawing removes your contributions from the research
              dataset.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          {failed ? (
            <Text style={styles.errorText}>
              Your consent could not be recorded. Please check your connection and try again.
            </Text>
          ) : null}
          <Pressable
            disabled={grant.isPending}
            onPress={agree}
            style={({ pressed }) => [
              styles.primaryButton,
              grant.isPending && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {grant.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>I agree to take part</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => router.replace("/")}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 20, paddingBottom: 24, gap: 14 },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#E6FFFB",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { color: "#0F766E", fontSize: 13, fontWeight: "700" },
  title: { color: "#102A43", fontSize: 30, lineHeight: 37, fontWeight: "700" },
  body: { color: "#486581", fontSize: 16, lineHeight: 24 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#D9E2EC",
    gap: 9,
  },
  assuranceCard: { backgroundColor: "#E6FFFB", borderColor: "#C6F6F1" },
  cardTitle: { color: "#102A43", fontSize: 18, fontWeight: "700" },
  cardBody: { color: "#486581", fontSize: 15, lineHeight: 22 },
  guaranteeRow: { flexDirection: "row", gap: 9, alignItems: "flex-start" },
  tick: { color: "#15803D", fontSize: 15, fontWeight: "800", lineHeight: 21 },
  guaranteeText: { color: "#334E68", fontSize: 14, lineHeight: 21, flex: 1 },
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
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#486581", fontSize: 15 },
});
