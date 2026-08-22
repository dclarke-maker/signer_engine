import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";

export default function SettingsScreen() {
  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>A transparent view of the research client configuration.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Workflow configuration</Text>
          <Text style={styles.cardText}>
            This mobile client reads the active research stage from the backend. The first scaffold uses a
            capture-stage fallback while the API configuration is loading.
          </Text>
          <View style={styles.row}>
            <Text style={styles.label}>Endpoint</Text>
            <Text style={styles.value}>Configured by app environment</Text>
          </View>
        </View>

        <View style={[styles.card, styles.privacyCard]}>
          <Text style={styles.cardTitle}>Participant privacy</Text>
          <Text style={styles.cardText}>
            Video captures are intended only for the approved research workflow. Confirm consent before
            recording and avoid recording bystanders or unrelated personal information.
          </Text>
        </View>

        <Text style={styles.version}>SignBridge · initial research scaffold</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 32, gap: 18 },
  title: { color: "#102A43", fontSize: 31, lineHeight: 38, fontWeight: "700", marginTop: 8 },
  subtitle: { color: "#486581", fontSize: 16, lineHeight: 23, marginBottom: 4 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#D9E2EC", gap: 11 },
  privacyCard: { backgroundColor: "#E6FFFB", borderColor: "#C6F6F1" },
  cardTitle: { color: "#102A43", fontSize: 18, fontWeight: "700" },
  cardText: { color: "#486581", fontSize: 15, lineHeight: 22 },
  row: { borderTopWidth: 1, borderTopColor: "#D9E2EC", paddingTop: 12, gap: 3 },
  label: { color: "#627D98", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  value: { color: "#102A43", fontSize: 14, fontWeight: "600" },
  version: { color: "#829AB1", fontSize: 13, textAlign: "center", marginTop: 6 },
});
