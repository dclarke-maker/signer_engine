import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";

export default function CaptureSubmittedScreen() {
  useEffect(() => {
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.content}>
        <View style={styles.confirmation}>
          <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
          <Text style={styles.title}>Sample submitted</Text>
          <Text style={styles.text}>
            Your capture has been handed to the configured research workflow. Thank you for contributing a clear signing sample.
          </Text>
        </View>
        <Pressable onPress={() => router.replace("/")} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>Return to workspace</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 24, justifyContent: "space-between" },
  confirmation: { flex: 1, justifyContent: "center", alignItems: "center", gap: 15 },
  check: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" },
  checkText: { color: "#15803D", fontSize: 42, fontWeight: "700" },
  title: { color: "#102A43", fontSize: 29, fontWeight: "700", textAlign: "center" },
  text: { color: "#486581", fontSize: 16, lineHeight: 24, textAlign: "center", maxWidth: 330 },
  button: { minHeight: 54, borderRadius: 16, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
