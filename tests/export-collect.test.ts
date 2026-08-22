import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  captureSessions,
  consentRecords,
  landmarkSequences,
  nmmTags,
  splitAssignments,
} from "../drizzle/schema";
import { getDb } from "../server/db";
import { grantConsent, withdrawConsent } from "../server/consent-service";
import { collectExportRows } from "../server/export-service";
import { seedSentencePrompts, storeSequenceForSession, startCaptureSession } from "../server/session-service";
import { assignSplits, persistSplitAssignments } from "../server/split-service";
import type { LandmarkSequencePayload } from "../shared/landmarks";

const KEEP = 7001;
const WITHDRAWN = 7002;

function payload(sessionId: string, promptId: string, category: string): LandmarkSequencePayload {
  return {
    schemaVersion: 1,
    sessionId,
    promptId,
    category,
    extractorId: "fixture@1",
    targetFps: 30,
    achievedFps: 29,
    frameCount: 60,
    durationMs: 2000,
    frames: [],
  };
}

/** Skipped unless DATABASE_URL points at a migrated database. */
describe.skipIf(!process.env.DATABASE_URL)("export collection", () => {
  it("returns stored sessions with prompt text, split, and tags, and excludes withdrawn signers", async () => {
    const db = (await getDb())!;
    for (const id of [KEEP, WITHDRAWN]) {
      await db.delete(captureSessions).where(eq(captureSessions.signerId, id));
      await db.delete(consentRecords).where(eq(consentRecords.signerId, id));
      await db.delete(splitAssignments).where(eq(splitAssignments.signerId, id));
    }
    await seedSentencePrompts();
    await persistSplitAssignments(assignSplits([KEEP, WITHDRAWN], "export-test-seed"));

    for (const id of [KEEP, WITHDRAWN]) {
      await grantConsent({ signerId: id, consentVersion: "v1", scopes: ["participation"] });
      const session = await startCaptureSession({ signerId: id, promptId: "B-02" });
      await storeSequenceForSession({
        sessionId: session.id,
        payload: payload(session.id, "B-02", "interrogative"),
        storageKey: `sequences/signer-${id}/${session.id}.json.gz`,
        sizeBytes: 4096,
        detections: [
          {
            type: "eyebrow_raise",
            startFrame: 10,
            endFrame: 40,
            confidence: 0.8,
            ruleVersion: "baseline-v1",
          },
        ],
      });
    }

    // One participant withdraws after contributing.
    await withdrawConsent(WITHDRAWN);

    const rows = await collectExportRows();
    const mine = rows.filter((r) => r.signerId === KEEP || r.signerId === WITHDRAWN);

    expect(mine.map((r) => r.signerId)).toEqual([KEEP]);
    const row = mine[0];
    expect(row.textEnglish).toBe("Where is the hospital?");
    expect(row.textNepali).toBe("अस्पताल कहाँ छ?");
    expect(row.category).toBe("interrogative");
    expect(row.extractorId).toBe("fixture@1");
    expect(row.storageKey).not.toMatch(/\.mp4$/);
    expect(row.split).toMatch(/^(train|validation|test)$/);
    expect(row.nmmTags).toHaveLength(1);
    expect(row.nmmTags[0]).toMatchObject({ type: "eyebrow_raise", ruleVersion: "baseline-v1" });
    // Confidence returns to the 0-1 domain it was recorded in.
    expect(row.nmmTags[0].confidence).toBeGreaterThan(0);
    expect(row.nmmTags[0].confidence).toBeLessThanOrEqual(1);

    for (const id of [KEEP, WITHDRAWN]) {
      await db.delete(captureSessions).where(eq(captureSessions.signerId, id));
      await db.delete(consentRecords).where(eq(consentRecords.signerId, id));
      await db.delete(splitAssignments).where(eq(splitAssignments.signerId, id));
    }
    await db.delete(nmmTags);
    await db.delete(landmarkSequences);
  });

  it("omits sessions that were superseded or skipped", async () => {
    const db = (await getDb())!;
    await db.delete(captureSessions).where(eq(captureSessions.signerId, KEEP));
    await db.delete(consentRecords).where(eq(consentRecords.signerId, KEEP));
    await seedSentencePrompts();
    await grantConsent({ signerId: KEEP, consentVersion: "v1", scopes: ["participation"] });

    const first = await startCaptureSession({ signerId: KEEP, promptId: "A-01" });
    await storeSequenceForSession({
      sessionId: first.id,
      payload: payload(first.id, "A-01", "declarative"),
      storageKey: `sequences/signer-${KEEP}/${first.id}.json.gz`,
      sizeBytes: 100,
      detections: [],
    });
    // A redo supersedes the first session; only the canonical one may export.
    await startCaptureSession({ signerId: KEEP, promptId: "A-01" });

    const rows = (await collectExportRows()).filter((r) => r.signerId === KEEP);
    expect(rows).toHaveLength(0);

    await db.delete(captureSessions).where(eq(captureSessions.signerId, KEEP));
    await db.delete(consentRecords).where(eq(consentRecords.signerId, KEEP));
    await db.delete(nmmTags);
    await db.delete(landmarkSequences);
  });
});
