import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { translationJobs } from "../drizzle/schema";
import { getDb } from "../server/db";
import {
  FIXTURE_MODEL_VERSION,
  createTranslationJob,
  getLatestTranslationJob,
} from "../server/translation-service";

/** Skipped unless DATABASE_URL points at a migrated database. */
describe.skipIf(!process.env.DATABASE_URL)("translation job lifecycle", () => {
  const SESSION = "translation-integration-session";

  it("records a complete job with model version and latency", async () => {
    const db = (await getDb())!;
    await db.delete(translationJobs).where(eq(translationJobs.sessionId, SESSION));

    const result = await createTranslationJob({ sessionId: SESSION, frameCount: 180 });
    expect(result.status).toBe("complete");
    expect(result.modelVersion).toBe(FIXTURE_MODEL_VERSION);
    expect(result.englishResponse.length).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(translationJobs)
      .where(eq(translationJobs.sessionId, SESSION));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("complete");
    expect(rows[0].modelVersion).toBe(FIXTURE_MODEL_VERSION);
    expect(rows[0].latencyMs).not.toBeNull();
    expect(rows[0].completedAt).not.toBeNull();
    // Confidence is stored as basis points and must never claim certainty.
    expect(rows[0].confidenceBp!).toBeGreaterThan(0);
    expect(rows[0].confidenceBp!).toBeLessThan(10_000);

    await db.delete(translationJobs).where(eq(translationJobs.sessionId, SESSION));
  });

  it("returns the most recent job for a session", async () => {
    const db = (await getDb())!;
    await db.delete(translationJobs).where(eq(translationJobs.sessionId, SESSION));

    await createTranslationJob({ sessionId: SESSION, frameCount: 60 });
    await new Promise((r) => setTimeout(r, 1100));
    const second = await createTranslationJob({ sessionId: SESSION, frameCount: 400 });

    const latest = await getLatestTranslationJob(SESSION);
    expect(latest!.id).toBe(second.id);

    await db.delete(translationJobs).where(eq(translationJobs.sessionId, SESSION));
  });
});
