import { and, desc, eq, isNull } from "drizzle-orm";

import { consentRecords } from "../drizzle/schema";
import { getDb } from "./db";

/** Bump when the participant-facing consent text changes materially. */
export const CURRENT_CONSENT_VERSION = "v1";

export const CONSENT_SCOPES = ["participation", "workshop_calibration"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

type ConsentShape = {
  consentVersion: string;
  withdrawnAt: Date | null;
  scopes: string;
};

export function parseScopes(raw: string): ConsentScope[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is ConsentScope =>
      (CONSENT_SCOPES as readonly unknown[]).includes(s),
    );
  } catch {
    return [];
  }
}

/**
 * A grant is current only if it exists, was made against the version in force,
 * and has not been withdrawn. A protocol amendment therefore invalidates prior
 * grants rather than silently reinterpreting them as agreement to new terms.
 */
export function isConsentCurrent(
  record: ConsentShape | null,
  version = CURRENT_CONSENT_VERSION,
): boolean {
  if (!record) return false;
  if (record.withdrawnAt !== null) return false;
  return record.consentVersion === version;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The consent database is not configured.");
  return db;
}

export async function getCurrentConsent(signerId: number) {
  const db = await requireDb();
  const row = (
    await db
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.signerId, signerId), isNull(consentRecords.withdrawnAt)))
      .orderBy(desc(consentRecords.grantedAt))
      .limit(1)
  )[0];
  return row ?? null;
}

export async function grantConsent(input: {
  signerId: number;
  consentVersion: string;
  scopes: ConsentScope[];
}) {
  const db = await requireDb();
  // Supersede any standing grant so a signer never holds two live records.
  await db
    .update(consentRecords)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(consentRecords.signerId, input.signerId), isNull(consentRecords.withdrawnAt)));

  await db.insert(consentRecords).values({
    signerId: input.signerId,
    consentVersion: input.consentVersion,
    scopes: JSON.stringify(input.scopes),
  });

  return { granted: true as const, consentVersion: input.consentVersion, scopes: input.scopes };
}

export async function withdrawConsent(signerId: number) {
  const db = await requireDb();
  await db
    .update(consentRecords)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(consentRecords.signerId, signerId), isNull(consentRecords.withdrawnAt)));
  return { granted: false as const };
}

/** Capture is unreachable without a current grant. Throws otherwise. */
export async function requireCurrentConsent(signerId: number) {
  const record = await getCurrentConsent(signerId);
  if (!isConsentCurrent(record)) {
    throw new Error("Research consent is required before capture.");
  }
  return record!;
}
