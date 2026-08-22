import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { saveSignerSession } from "@/lib/signer-session";
import { trpc } from "@/lib/trpc";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signIn = trpc.signer.signIn.useMutation();

  const submit = async () => {
    try {
      const session = await signIn.mutateAsync({ email, password });
      await saveSignerSession(session.token, session.signer);
      router.replace("/");
    } catch {
      // The screen deliberately keeps the email value so the signer only needs to correct their password.
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.content}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.close, pressed && styles.pressed]}><Text style={styles.closeText}>×</Text></Pressable>
        <View style={styles.copy}>
          <View style={styles.mark}><Text style={styles.markText}>S</Text></View>
          <Text style={styles.title}>Signer sign in</Text>
          <Text style={styles.subtitle}>Use the email address approved by the study administrator.</Text>
        </View>
        <View style={styles.form}>
          <View style={styles.field}><Text style={styles.label}>Email address</Text><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" placeholder="name@example.com" placeholderTextColor="#829AB1" style={styles.input} /></View>
          <View style={styles.field}><Text style={styles.label}>Password</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Your password" placeholderTextColor="#829AB1" style={styles.input} onSubmitEditing={submit} returnKeyType="done" /></View>
          {signIn.isError ? <Text style={styles.errorText}>We could not sign you in. Check your email and password, then try again.</Text> : null}
          <Pressable disabled={!email || !password || signIn.isPending} onPress={submit} style={({ pressed }) => [styles.button, (!email || !password || signIn.isPending) && styles.disabled, pressed && styles.pressed]}>
            {signIn.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Sign in to capture</Text>}
          </Pressable>
        </View>
        <Text style={styles.help}>New to SignBridge? Use the one-time setup link in your invitation email before signing in.</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 24, gap: 24 }, close: { alignSelf: "flex-end", width: 42, height: 42, borderRadius: 21, backgroundColor: "#E6FFFB", alignItems: "center", justifyContent: "center" }, closeText: { color: "#0F766E", fontSize: 30, lineHeight: 33, fontWeight: "300" }, copy: { gap: 10, marginTop: 22 }, mark: { width: 48, height: 48, borderRadius: 14, backgroundColor: "#0F766E", justifyContent: "center", alignItems: "center" }, markText: { color: "#FFFFFF", fontSize: 25, fontWeight: "800" }, title: { color: "#102A43", fontSize: 30, fontWeight: "700" }, subtitle: { color: "#486581", fontSize: 16, lineHeight: 23 }, form: { gap: 17, marginTop: 10 }, field: { gap: 7 }, label: { color: "#334E68", fontSize: 14, fontWeight: "700" }, input: { height: 52, borderWidth: 1, borderColor: "#9FB3C8", borderRadius: 15, paddingHorizontal: 14, color: "#102A43", fontSize: 16 }, button: { height: 54, borderRadius: 16, backgroundColor: "#0F766E", alignItems: "center", justifyContent: "center", marginTop: 4 }, buttonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" }, disabled: { backgroundColor: "#9FB3C8" }, errorText: { color: "#B91C1C", fontSize: 14, lineHeight: 20 }, help: { color: "#627D98", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: "auto" }, pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
