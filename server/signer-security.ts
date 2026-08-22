import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

export const signerSessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export const signerInvitationLifetimeMs = 72 * 60 * 60 * 1000;

export function normalizeSignerEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export async function hashSignerPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifySignerPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function extractBearerToken(authorization: string | string[] | undefined) {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim() || null;
}
