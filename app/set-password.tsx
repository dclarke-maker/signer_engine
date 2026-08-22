import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { saveSignerSession } from "@/lib/signer-session";
import { trpc } from "@/lib/trpc";

export default function SetPasswordScreen() {
  const { token: initialToken } = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(initialToken ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const accept = trpc.signer.acceptInvitation.useMutation();
  const passwordsMatch = password === confirmation;

  const submit = async () => {
    if (!passwordsMatch) return;
    try {
      const session = await accept.mutateAsync({ token, password });
      await saveSignerSession(session.token, session.signer);
      router.replace("/");
    } catch {
      // Explain the issue in context without exposing invitation validation details.
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.content}>
        <View style={styles.copy}><Text style={styles.eyebrow}>Approved signer</Text><Text style={styles.title}>Set your password</Text><Text style={styles.subtitle}>Choose a password with at least 12 characters to activate your signer account.</Text></View>
        <View style={styles.form}>
          <View style={styles.field}><Text style={styles.label}>Invitation token</Text><TextInput value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} placeholder="Token from your invitation link" placeholderTextColor="#829AB1" style={styles.input} /></View>
          <View style={styles.field}><Text style={styles.label}>New password</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 12 characters" placeholderTextColor="#829AB1" style={styles.input} /></View>
          <View style={styles.field}><Text style={styles.label}>Confirm password</Text><TextInput value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" placeholder="Repeat password" placeholderTextColor="#829AB1" style={styles.input} /></View>
          {confirmation && !passwordsMatch ? <Text style={styles.errorText}>The two passwords do not match.</Text> : null}
          {accept.isError ? <Text style={styles.errorText}>This invitation could not be activated. It may have expired.</Text> : null}
          <Pressable disabled={token.length < 20 || password.length < 12 || !passwordsMatch || accept.isPending} onPress={submit} style={({ pressed }) => [styles.button, (token.length < 20 || password.length < 12 || !passwordsMatch || accept.isPending) && styles.disabled, pressed && styles.pressed]}>{accept.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Activate signer account</Text>}</Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 24, justifyContent: "center", gap: 28 }, copy: { gap: 9 }, eyebrow: { color: "#0F766E", fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }, title: { color: "#102A43", fontSize: 30, fontWeight: "700" }, subtitle: { color: "#486581", fontSize: 16, lineHeight: 23 }, form: { gap: 16 }, field: { gap: 7 }, label: { color: "#334E68", fontSize: 14, fontWeight: "700" }, input: { height: 52, borderWidth: 1, borderColor: "#9FB3C8", borderRadius: 15, paddingHorizontal: 14, color: "#102A43", fontSize: 16 }, button: { height: 54, borderRadius: 16, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center", marginTop: 4 }, buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" }, disabled: { backgroundColor: "#9FB3C8" }, errorText: { color: "#B91C1C", fontSize: 14 }, pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
