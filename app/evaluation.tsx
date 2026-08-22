import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function EvaluationScreen() {
  const evaluationQuery = trpc.evaluation.next.useQuery();
  const evaluation = evaluationQuery.data;
  const englishResponse = evaluation?.englishResponse ?? "The interpretation is being prepared.";

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.eyebrowRow}><Text style={styles.eyebrow}>Evaluation stage</Text></View>
        <Text style={styles.title}>Review the English response</Text>
        <Text style={styles.subtitle}>
          Compare the supplied interpretation with the signing sample presented by the evaluation workflow.
        </Text>

        <View style={styles.sampleCard}>
          <View style={styles.playButton}><Text style={styles.playText}>▶</Text></View>
          <View style={styles.sampleCopy}>
            <Text style={styles.sampleTitle}>Signing sample</Text>
          <Text style={styles.sampleText}>{evaluation?.sampleStatus === "fixture" ? "Initial scaffold fixture supplied by the evaluation endpoint." : "Loading evaluation sample."}</Text>
          </View>
        </View>

        <View style={styles.responseCard}>
          <Text style={styles.responseLabel}>English interpretation</Text>
          <Text style={styles.responseText}>“{englishResponse}”</Text>
          <Text style={styles.disclaimer}>This is an automated response. Please judge it against the original signing.</Text>
        </View>

        <Pressable
          disabled={!evaluation || evaluationQuery.isError}
          onPress={() => router.push({ pathname: "/feedback", params: { evaluationId: evaluation?.id ?? "", englishResponse } } as never)}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>{evaluationQuery.isLoading ? "Loading evaluation…" : evaluationQuery.isError ? "Evaluation unavailable" : "Rate this interpretation"}</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 30, gap: 18 },
  eyebrowRow: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#E6FFFB", paddingHorizontal: 11, paddingVertical: 6 },
  eyebrow: { color: "#0F766E", fontSize: 13, fontWeight: "700" },
  title: { color: "#102A43", fontSize: 30, lineHeight: 37, fontWeight: "700", marginTop: 2 },
  subtitle: { color: "#486581", fontSize: 16, lineHeight: 23 },
  sampleCard: { backgroundColor: "#102A43", borderRadius: 22, padding: 19, flexDirection: "row", alignItems: "center", gap: 14 },
  playButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#E6FFFB", alignItems: "center", justifyContent: "center" },
  playText: { color: "#0F766E", fontSize: 17, marginLeft: 2 },
  sampleCopy: { flex: 1, gap: 3 },
  sampleTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  sampleText: { color: "#D9E2EC", fontSize: 13, lineHeight: 18 },
  responseCard: { backgroundColor: "#FFF7ED", borderRadius: 22, padding: 21, gap: 11 },
  responseLabel: { color: "#B45309", fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  responseText: { color: "#7C2D12", fontSize: 23, lineHeight: 32, fontWeight: "600" },
  disclaimer: { color: "#9A3412", fontSize: 13, lineHeight: 19 },
  primaryButton: { minHeight: 54, borderRadius: 16, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
