import { describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

import { signerAccounts, signerInvitations } from "../drizzle/schema";
import { getDb } from "../server/db";
import { createSignerInvitation, revokeSignerInvitation } from "../server/signer-service";

const EMAIL = "orphan-test@example.test";

async function pendingCount(signerId: number) {
  const db = (await getDb())!;
  const rows = await db
    .select()
    .from(signerInvitations)
    .where(and(eq(signerInvitations.signerId, signerId), isNull(signerInvitations.acceptedAt)));
  return rows.length;
}

/** Skipped unless DATABASE_URL points at a migrated database. */
describe.skipIf(!process.env.DATABASE_URL)("invitation integrity", () => {
  it("leaves no pending invitation behind when delivery fails", async () => {
    const db = (await getDb())!;
    await db.delete(signerAccounts).where(eq(signerAccounts.email, EMAIL));

    const invitation = await createSignerInvitation({ email: EMAIL, displayName: "Orphan Test" });
    expect(await pendingCount(invitation.signer.id)).toBe(1);

    // Delivery failed: the token was never communicated, so the invitation is
    // unusable. Leaving it pending would block nothing but confuse everything -
    // the administrator cannot resend it and cannot see why.
    await revokeSignerInvitation(invitation.invitationId);
    expect(await pendingCount(invitation.signer.id)).toBe(0);

    await db.delete(signerAccounts).where(eq(signerAccounts.email, EMAIL));
  });

  it("exposes the invitation id so a failed send can be undone", async () => {
    const db = (await getDb())!;
    await db.delete(signerAccounts).where(eq(signerAccounts.email, EMAIL));

    const invitation = await createSignerInvitation({ email: EMAIL });
    expect(typeof invitation.invitationId).toBe("number");
    expect(invitation.invitationId).toBeGreaterThan(0);

    await db.delete(signerAccounts).where(eq(signerAccounts.email, EMAIL));
  });

  it("revoking an unknown invitation is a no-op rather than an error", async () => {
    await expect(revokeSignerInvitation(999_999_999)).resolves.not.toThrow();
  });
});
