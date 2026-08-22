import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { stageDetails, type WorkflowStage } from "@/shared/workflow";

export default function WorkspaceScreen() {
  const workflowQuery = trpc.workflow.getConfig.useQuery(undefined, { staleTime: 20_000 });
  const activeStage = workflowQuery.data?.stage ?? ("capture" as WorkflowStage);
  const details = stageDetails[activeStage];

  const openActiveStage = () => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push((activeStage === "capture" ? "/capture" : "/evaluation") as never);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.mark}>
              <Text style={styles.markText}>S</Text>
            </View>
            <Text style={styles.brandName}>SignBridge</Text>
          </View>
          <Text style={styles.title}>Research workspace</Text>
          <Text style={styles.subtitle}>
            The active stage is controlled by the study configuration. This client will refresh from the
            API as the study changes.
          </Text>
        </View>

        <View style={styles.stageCard}>
          <View style={styles.stageMeta}>
            <View style={styles.stagePill}>
              <Text style={styles.stagePillText}>{details.badge}</Text>
            </View>
            <Text style={[styles.configLabel, workflowQuery.isError && styles.configError]}>
              {workflowQuery.isLoading ? "Checking API" : workflowQuery.isError ? "Using safe fallback" : `API v${workflowQuery.data?.version}`}
            </Text>
          </View>
          <Text style={styles.cardTitle}>{details.title}</Text>
          <Text style={styles.cardDescription}>{details.description}</Text>

          <Pressable onPress={openActiveStage} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{details.action}</Text>
            <Text style={styles.buttonArrow}>›</Text>
          </Pressable>
        </View>

        <View style={styles.guidanceCard}>
          <Text style={styles.guidanceEyebrow}>Before you begin</Text>
          <Text style={styles.guidanceTitle}>A clear, respectful contribution</Text>
          <Text style={styles.guidanceText}>
            Use even lighting, keep both hands visible, and do not include people who have not agreed to
            participate. You can review every capture before it is submitted.
          </Text>
        </View>

        <View style={styles.footerStatus}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>
            {workflowQuery.isError
              ? "The configuration service is unavailable; capture mode is selected safely."
              : "The active research stage is supplied by the API configuration."}
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 20, paddingBottom: 32, gap: 22 },
  header: { gap: 9, paddingTop: 8 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  mark: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center" },
  markText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  brandName: { color: "#0F766E", fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  title: { color: "#102A43", fontSize: 31, lineHeight: 38, fontWeight: "700", marginTop: 8 },
  subtitle: { color: "#486581", fontSize: 16, lineHeight: 23, maxWidth: 440 },
  stageCard: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 22, borderWidth: 1, borderColor: "#C6F6F1", gap: 14, shadowColor: "#102A43", shadowOpacity: 0.08, shadowRadius: 18, elevation: 3 },
  stageMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  stagePill: { backgroundColor: "#E6FFFB", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  stagePillText: { color: "#0F766E", fontSize: 13, fontWeight: "700" },
  configLabel: { color: "#B45309", fontSize: 12, fontWeight: "600" },
  configError: { color: "#B91C1C" },
  cardTitle: { color: "#102A43", fontSize: 23, lineHeight: 29, fontWeight: "700" },
  cardDescription: { color: "#486581", fontSize: 16, lineHeight: 23 },
  primaryButton: { minHeight: 52, borderRadius: 15, backgroundColor: "#0F766E", marginTop: 6, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  buttonArrow: { color: "#FFFFFF", fontSize: 28, fontWeight: "300", lineHeight: 28 },
  guidanceCard: { backgroundColor: "#FFF7ED", borderRadius: 20, padding: 20, gap: 8 },
  guidanceEyebrow: { color: "#B45309", fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  guidanceTitle: { color: "#7C2D12", fontSize: 19, fontWeight: "700" },
  guidanceText: { color: "#7C2D12", fontSize: 15, lineHeight: 22 },
  footerStatus: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#B45309" },
  statusText: { flex: 1, color: "#627D98", fontSize: 13, lineHeight: 18 },
});
