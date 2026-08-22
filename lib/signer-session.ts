import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SIGNER_TOKEN_KEY = "signbridge.signer-token";
const SIGNER_PROFILE_KEY = "signbridge.signer-profile";

export type SignerProfile = {
  id: number;
  email: string;
  displayName: string | null;
  status: "invited" | "active" | "disabled";
};

async function readValue(key: string) {
  return Platform.OS === "web" ? window.sessionStorage.getItem(key) : SecureStore.getItemAsync(key);
}

async function writeValue(key: string, value: string) {
  if (Platform.OS === "web") {
    window.sessionStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeValue(key: string) {
  if (Platform.OS === "web") {
    window.sessionStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getSignerSessionToken() {
  return readValue(SIGNER_TOKEN_KEY);
}

export async function getSignerProfile(): Promise<SignerProfile | null> {
  const raw = await readValue(SIGNER_PROFILE_KEY);
  return raw ? (JSON.parse(raw) as SignerProfile) : null;
}

export async function saveSignerSession(token: string, signer: SignerProfile) {
  await writeValue(SIGNER_TOKEN_KEY, token);
  await writeValue(SIGNER_PROFILE_KEY, JSON.stringify(signer));
}

export async function clearSignerSession() {
  await Promise.all([removeValue(SIGNER_TOKEN_KEY), removeValue(SIGNER_PROFILE_KEY)]);
}
