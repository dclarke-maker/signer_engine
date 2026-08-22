import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { getApiBaseUrl } from "@/constants/oauth";
import { getExtractor } from "@/lib/extractors";
import { clearSignerSession } from "@/lib/signer-session";
import { trpc } from "@/lib/trpc";

const GUARANTEES = [
  "No facial images are stored or transmitted.",
  "No personally identifiable visual data is retained.",
  "Anonymisation happens on this device, before anything is sent.",
  "Only the motion points needed for the research are collected.",
];

export default function SettingsScreen() {
  const utils = trpc.useUtils();
  const signerQuery = trpc.signer.me.useQuery();
  const consentQuery = trpc.consent.status.useQuery();
  const workflowQuery = trpc.workflow.getConfig.useQuery();
  const withdraw = trpc.consent.withdraw.useMutation();
  const signOut = trpc.signer.signOut.useMutation();
  const [confirming, setConfirming] = useState(false);

  const endpoint = getApiBaseUrl() || "same origin as this app";
  const version = Constants.expoConfig?.version ?? "unknown";

  const confirmWithdraw = async () => {
    await withdraw.mutateAsync();
    await utils.consent.status.invalidate();
    setConfirming(false);
  };

  const endSession = async () => {
    await signOut.mutateAsync().catch(() => undefined);
    await clearSignerSession();
    await utils.invalidate();
    router.replace("/");
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>A transparent view of this research client.</Text>

        <View style={[styles.card, styles.privacyCard]}>
          <Text style={styles.cardTitle}>What this app collects</Text>
          <Text style={styles.cardText}>
            While you sign, this device measures the position of your hands, face, and upper body
            and turns them into numbers. Only those numbers are sent, with the sentence and its
            category. No video is recorded and none is saved.
          </Text>
          {GUARANTEES.map((line) => (
            <View key={line} style={styles.guaranteeRow}>
              <Text style={styles.tick}>✓</Text>
              <Text style={styles.guaranteeText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Research consent</Text>
          {consentQuery.data?.granted ? (
            <>
              <Text style={styles.cardText}>
                You have agreed to take part under consent version{" "}
                {consentQuery.data.consentVersion}. You can withdraw at any time; your contributions
                are then excluded from the research dataset.
              </Text>
              {confirming ? (
                <View style={styles.confirmBlock}>
                  <Text style={styles.confirmText}>
                    Withdraw consent and stop contributing to the study?
                  </Text>
                  <Pressable
                    disabled={withdraw.isPending}
                    onPress={confirmWithdraw}
                    style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.dangerButtonText}>Yes, withdraw my consent</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setConfirming(false)}
                    style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.linkButtonText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setConfirming(true)}
                  style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
                >
                  <Text style={styles.outlineButtonText}>Withdraw consent</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={styles.cardText}>
                You have not agreed to take part yet. Consent is required before any sample can be
                collected.
              </Text>
              {signerQuery.data ? (
                <Pressable
                  onPress={() => router.push("/consent")}
                  style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
                >
                  <Text style={styles.outlineButtonText}>Review and give consent</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Configuration</Text>
          <View style={styles.row}>
            <Text style={styles.label}>API endpoint</Text>
            <Text style={styles.value}>{endpoint}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Active stage</Text>
            <Text style={styles.value}>
              {workflowQuery.data
                ? `${workflowQuery.data.stage} · ${workflowQuery.data.version}`
                : "loading"}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Motion extractor</Text>
            <Text style={styles.value}>{getExtractor().id}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>App version</Text>
            <Text style={styles.value}>{version}</Text>
          </View>
          <Pressable
            onPress={() => utils.invalidate()}
            style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
          >
            <Text style={styles.outlineButtonText}>Refresh from the API</Text>
          </Pressable>
        </View>

        {signerQuery.data ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Signed in</Text>
            <Text style={styles.cardText}>{signerQuery.data.email}</Text>
            <Pressable
              onPress={endSession}
              style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
            >
              <Text style={styles.outlineButtonText}>Sign out</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.footer}>SignBridge · Nepali Sign Language research client</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 32, gap: 16 },
  title: { color: "#102A43", fontSize: 31, lineHeight: 38, fontWeight: "700", marginTop: 8 },
  subtitle: { color: "#486581", fontSize: 16, lineHeight: 23, marginBottom: 2 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#D9E2EC",
    gap: 11,
  },
  privacyCard: { backgroundColor: "#E6FFFB", borderColor: "#C6F6F1" },
  cardTitle: { color: "#102A43", fontSize: 18, fontWeight: "700" },
  cardText: { color: "#486581", fontSize: 15, lineHeight: 22 },
  guaranteeRow: { flexDirection: "row", gap: 9, alignItems: "flex-start" },
  tick: { color: "#15803D", fontSize: 15, fontWeight: "800", lineHeight: 21 },
  guaranteeText: { color: "#334E68", fontSize: 14, lineHeight: 21, flex: 1 },
  row: { borderTopWidth: 1, borderTopColor: "#D9E2EC", paddingTop: 11, gap: 3 },
  label: {
    color: "#627D98",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  value: { color: "#102A43", fontSize: 14, fontWeight: "600" },
  outlineButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  outlineButtonText: { color: "#0F766E", fontSize: 15, fontWeight: "700" },
  dangerButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#B91C1C",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkButtonText: { color: "#486581", fontSize: 15, fontWeight: "600" },
  confirmBlock: { gap: 9, marginTop: 4 },
  confirmText: { color: "#B45309", fontSize: 14, lineHeight: 21, fontWeight: "600" },
  footer: { color: "#829AB1", fontSize: 13, textAlign: "center", marginTop: 6 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
