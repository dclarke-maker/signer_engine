import { and, eq, gt, isNull } from "drizzle-orm";

import { signerAccounts, signerInvitations, signerSessions, type SignerAccount } from "../drizzle/schema";
import { getDb } from "./db";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashSignerPassword,
  normalizeSignerEmail,
  signerInvitationLifetimeMs,
  signerSessionLifetimeMs,
  verifySignerPassword,
} from "./signer-security";

function publicSigner(account: SignerAccount) {
  return { id: account.id, email: account.email, displayName: account.displayName, status: account.status } as const;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The signer database is not configured.");
  return db;
}

export async function createSignerInvitation(input: { email: string; displayName?: string }) {
  const db = await requireDb();
  const email = normalizeSignerEmail(input.email);
  await db
    .insert(signerAccounts)
    .values({ email, displayName: input.displayName?.trim() || null, status: "invited" })
    .onDuplicateKeyUpdate({ set: { displayName: input.displayName?.trim() || null } });

  const signer = (await db.select().from(signerAccounts).where(eq(signerAccounts.email, email)).limit(1))[0];
  if (!signer) throw new Error("Unable to create the signer account.");

  await db
    .update(signerInvitations)
    .set({ acceptedAt: new Date() })
    .where(and(eq(signerInvitations.signerId, signer.id), isNull(signerInvitations.acceptedAt)));

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + signerInvitationLifetimeMs);
  const tokenHash = hashOpaqueToken(token);
  await db.insert(signerInvitations).values({ signerId: signer.id, tokenHash, expiresAt });

  // The caller needs this to undo the invitation if delivery fails: the raw
  // token is shown once and never stored, so an invitation whose email never
  // arrived can never be used or resent.
  const created = (
    await db.select().from(signerInvitations).where(eq(signerInvitations.tokenHash, tokenHash)).limit(1)
  )[0];

  return { signer: publicSigner(signer), token, expiresAt, invitationId: created.id };
}

/**
 * Removes an invitation that was created but never delivered.
 *
 * Creating an invitation invalidates any previous pending one, so a failed send
 * that left its row behind would block nothing but confuse everything: the
 * administrator cannot resend it, cannot see why, and each retry orphans
 * another. Unknown ids are a no-op so cleanup is always safe to attempt.
 */
export async function revokeSignerInvitation(invitationId: number) {
  const db = await requireDb();
  await db.delete(signerInvitations).where(eq(signerInvitations.id, invitationId));
}

export async function acceptSignerInvitation(input: { token: string; password: string }) {
  const db = await requireDb();
  const invitation = (
    await db
      .select()
      .from(signerInvitations)
      .where(
        and(
          eq(signerInvitations.tokenHash, hashOpaqueToken(input.token)),
          isNull(signerInvitations.acceptedAt),
          gt(signerInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1)
  )[0];
  if (!invitation) throw new Error("This invitation is invalid or has expired.");

  const passwordHash = await hashSignerPassword(input.password);
  await db.update(signerAccounts).set({ passwordHash, status: "active" }).where(eq(signerAccounts.id, invitation.signerId));
  await db.update(signerInvitations).set({ acceptedAt: new Date() }).where(eq(signerInvitations.id, invitation.id));

  const signer = (await db.select().from(signerAccounts).where(eq(signerAccounts.id, invitation.signerId)).limit(1))[0];
  if (!signer) throw new Error("Signer account was not found.");
  return createSignerSession(signer);
}

export async function signInSigner(input: { email: string; password: string }) {
  const db = await requireDb();
  const email = normalizeSignerEmail(input.email);
  const signer = (await db.select().from(signerAccounts).where(eq(signerAccounts.email, email)).limit(1))[0];
  if (!signer || signer.status !== "active" || !signer.passwordHash) {
    throw new Error("Email or password is incorrect.");
  }
  if (!(await verifySignerPassword(input.password, signer.passwordHash))) {
    throw new Error("Email or password is incorrect.");
  }
  await db.update(signerAccounts).set({ lastSignedIn: new Date() }).where(eq(signerAccounts.id, signer.id));
  return createSignerSession(signer);
}

async function createSignerSession(signer: SignerAccount) {
  const db = await requireDb();
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + signerSessionLifetimeMs);
  await db.insert(signerSessions).values({ signerId: signer.id, tokenHash: hashOpaqueToken(token), expiresAt });
  return { token, expiresAt, signer: publicSigner(signer) };
}

export async function getSignerFromSessionToken(token: string) {
  const db = await requireDb();
  const session = (
    await db
      .select()
      .from(signerSessions)
      .where(and(eq(signerSessions.tokenHash, hashOpaqueToken(token)), gt(signerSessions.expiresAt, new Date())))
      .limit(1)
  )[0];
  if (!session) return null;
  const signer = (await db.select().from(signerAccounts).where(eq(signerAccounts.id, session.signerId)).limit(1))[0];
  return signer?.status === "active" ? publicSigner(signer) : null;
}

export async function deleteSignerSession(token: string) {
  const db = await requireDb();
  await db.delete(signerSessions).where(eq(signerSessions.tokenHash, hashOpaqueToken(token)));
}
