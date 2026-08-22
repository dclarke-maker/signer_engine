import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { consentRecords } from "../drizzle/schema";
import {
  getCurrentConsent,
  grantConsent,
  isConsentCurrent,
  requireCurrentConsent,
  withdrawConsent,
} from "../server/consent-service";
import { getDb } from "../server/db";

const SIGNER = 4242;

/**
 * Exercises the DB-backed consent paths. Skipped unless DATABASE_URL points at a
 * migrated database, so the default suite stays runnable without one:
 *   DATABASE_URL=mysql://... pnpm vitest run tests/consent-integration.test.ts
 */
describe.skipIf(!process.env.DATABASE_URL)("consent persistence", () => {
  it("grants, supersedes, withdraws, and gates capture", async () => {
    const db = (await getDb())!;
    expect(db).toBeTruthy();
    await db.delete(consentRecords).where(eq(consentRecords.signerId, SIGNER));

    expect(isConsentCurrent(await getCurrentConsent(SIGNER))).toBe(false);

    await grantConsent({ signerId: SIGNER, consentVersion: "v1", scopes: ["participation"] });
    expect(isConsentCurrent(await getCurrentConsent(SIGNER))).toBe(true);

    await grantConsent({
      signerId: SIGNER,
      consentVersion: "v1",
      scopes: ["participation", "workshop_calibration"],
    });
    const live = await db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.signerId, SIGNER));
    expect(live.filter((r) => r.withdrawnAt === null)).toHaveLength(1);
    expect(live).toHaveLength(2);
    expect((await getCurrentConsent(SIGNER))!.scopes).toContain("workshop_calibration");

    await withdrawConsent(SIGNER);
    expect(isConsentCurrent(await getCurrentConsent(SIGNER))).toBe(false);
    await expect(requireCurrentConsent(SIGNER)).rejects.toThrow(/consent is required/i);

    await db.delete(consentRecords).where(eq(consentRecords.signerId, SIGNER));
  });
});
