import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function CaptureReviewScreen() {
  const { recordingUri } = useLocalSearchParams<{ recordingUri?: string }>();
  const submitCapture = trpc.capture.submit.useMutation();

  const submit = async () => {
    try {
      const result = await submitCapture.mutateAsync({
        clientRecordedAt: new Date().toISOString(),
        mimeType: "video/mp4",
      });
      if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: "/capture-submitted", params: { captureId: result.id, recordingUri } } as never);
    } catch {
      // The UI below exposes the submission failure without discarding the local capture.
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.content}>
        <View style={styles.previewPlaceholder}>
          <View style={styles.playCircle}><Text style={styles.playText}>▶</Text></View>
          <Text style={styles.previewTitle}>Recording ready for review</Text>
          <Text style={styles.previewText}>Your video remains on this device until you select Submit sample.</Text>
        </View>

        <View style={styles.copyBlock}>
          <Text style={styles.title}>Check your signing sample</Text>
          <Text style={styles.text}>
            Ensure your hands and upper body were visible. If the capture is unclear, record a new sample instead.
          </Text>
        </View>

        <View style={styles.actionBlock}>
          <Pressable disabled={submitCapture.isPending} onPress={submit} style={({ pressed }) => [styles.submitButton, submitCapture.isPending && styles.disabledButton, pressed && styles.pressed]}>
            <Text style={styles.submitButtonText}>{submitCapture.isPending ? "Submitting…" : "Submit sample"}</Text>
          </Pressable>
          <Pressable onPress={() => router.replace("/capture" as never)} style={({ pressed }) => [styles.retakeButton, pressed && styles.pressed]}>
            <Text style={styles.retakeButtonText}>Record again</Text>
          </Pressable>
          <Text style={styles.privacy}>Submitted clips are stored through the configured research storage boundary.</Text>
          {submitCapture.isError ? <Text style={styles.errorText}>The submission could not be completed. Your local capture is still available to retry.</Text> : null}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20, gap: 26, justifyContent: "space-between" },
  previewPlaceholder: { minHeight: 320, borderRadius: 28, backgroundColor: "#102A43", justifyContent: "center", alignItems: "center", padding: 28, gap: 13 },
  playCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#E6FFFB", alignItems: "center", justifyContent: "center" },
  playText: { color: "#0F766E", fontSize: 22, marginLeft: 3 },
  previewTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", textAlign: "center" },
  previewText: { color: "#D9E2EC", fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 260 },
  copyBlock: { gap: 8 },
  title: { color: "#102A43", fontSize: 27, lineHeight: 33, fontWeight: "700" },
  text: { color: "#486581", fontSize: 16, lineHeight: 23 },
  actionBlock: { gap: 12 },
  submitButton: { minHeight: 54, borderRadius: 16, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center" },
  submitButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  retakeButton: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: "#9FB3C8", alignItems: "center", justifyContent: "center" },
  retakeButtonText: { color: "#102A43", fontSize: 16, fontWeight: "700" },
  privacy: { color: "#627D98", fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 2 },
  errorText: { color: "#B91C1C", fontSize: 13, lineHeight: 18, textAlign: "center" },
  disabledButton: { opacity: 0.65 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
