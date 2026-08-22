import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { CORPUS_CATEGORIES, SENTENCES_PER_CATEGORY, type CorpusCategory } from "@/shared/corpus";
import { trpc } from "@/lib/trpc";

const CATEGORY_LABEL: Record<CorpusCategory, string> = {
  declarative: "Statements",
  interrogative: "Questions",
  negation: "Negation",
  temporal: "Time",
  utility: "Everyday",
};

export default function ProgressScreen() {
  const signerQuery = trpc.signer.me.useQuery();
  const progressQuery = trpc.capture.progress.useQuery(undefined, {
    enabled: !!signerQuery.data,
  });

  if (!signerQuery.isLoading && !signerQuery.data) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.title}>Your contribution</Text>
          <Text style={styles.body}>Sign in to see how far through the sentence set you are.</Text>
          <Pressable
            onPress={() => router.push("/sign-in")}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Sign in</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (progressQuery.isLoading || signerQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={styles.centered}>
          <ActivityIndicator color="#0F766E" />
          <Text style={styles.body}>Loading your contribution…</Text>
        </View>
      </ScreenContainer>
    );
  }

  const progress = progressQuery.data;
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 100;
  const skipped = progress?.skipped ?? 0;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Your contribution</Text>
        <Text style={styles.subtitle}>
          Sentences are given to you spread evenly across the five categories, so a partial set is
          still useful to the research.
        </Text>

        <View style={styles.headlineCard}>
          <Text style={styles.headlineValue}>
            {completed}
            <Text style={styles.headlineTotal}> / {total}</Text>
          </Text>
          <Text style={styles.headlineLabel}>sentences signed</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${percent}%` }]} />
          </View>
          {skipped > 0 ? (
            <Text style={styles.skipped}>
              {skipped} skipped — you can come back to them at any time.
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>By category</Text>
          {CORPUS_CATEGORIES.map((category) => {
            const done = progress?.byCategory?.[category] ?? 0;
            const width = Math.round((done / SENTENCES_PER_CATEGORY) * 100);
            return (
              <View key={category} style={styles.row}>
                <Text style={styles.rowLabel}>{CATEGORY_LABEL[category]}</Text>
                <View style={styles.rowTrack}>
                  <View style={[styles.rowFill, { width: `${width}%` }]} />
                </View>
                <Text style={styles.rowValue}>
                  {done}/{SENTENCES_PER_CATEGORY}
                </Text>
              </View>
            );
          })}
        </View>

        {completed < total ? (
          <Pressable
            onPress={() => router.push("/prompt-session")}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Continue signing</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 32, gap: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 13 },
  title: { color: "#102A43", fontSize: 31, lineHeight: 38, fontWeight: "700", marginTop: 8 },
  subtitle: { color: "#486581", fontSize: 16, lineHeight: 23 },
  body: { color: "#486581", fontSize: 16, lineHeight: 23, textAlign: "center" },
  headlineCard: { backgroundColor: "#E6FFFB", borderRadius: 22, padding: 20, gap: 10 },
  headlineValue: { color: "#0F766E", fontSize: 40, fontWeight: "800" },
  headlineTotal: { color: "#486581", fontSize: 22, fontWeight: "700" },
  headlineLabel: { color: "#334E68", fontSize: 15, fontWeight: "600" },
  track: { height: 10, borderRadius: 999, backgroundColor: "#C6F6F1", overflow: "hidden" },
  fill: { height: 10, borderRadius: 999, backgroundColor: "#0F766E" },
  skipped: { color: "#B45309", fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#D9E2EC",
    gap: 12,
  },
  cardTitle: { color: "#102A43", fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { color: "#334E68", fontSize: 14, width: 82 },
  rowTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#D9E2EC",
    overflow: "hidden",
  },
  rowFill: { height: 8, borderRadius: 999, backgroundColor: "#0F766E" },
  rowValue: { color: "#334E68", fontSize: 13, fontWeight: "700", width: 44, textAlign: "right" },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
