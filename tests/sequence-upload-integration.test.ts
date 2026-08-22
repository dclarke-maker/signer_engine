import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { captureSessions, consentRecords, landmarkSequences, nmmTags } from "../drizzle/schema";
import { grantConsent } from "../server/consent-service";
import { getDb } from "../server/db";
import { putLandmarkSequence, sequenceObjectKey } from "../server/sequence-storage";
import {
  getCaptureSession,
  getNextPromptForSigner,
  getSignerProgress,
  seedSentencePrompts,
  skipPrompt,
  startCaptureSession,
  storeSequenceForSession,
} from "../server/session-service";
import { computeSignerBaseline } from "../server/nmm/baseline";
import { detectNmms } from "../server/nmm/rules";
import { makeNeutralSequence, makePoseFrame } from "./fixtures/landmark-frames";
import type { LandmarkSequencePayload } from "../shared/landmarks";

const SIGNER = 5150;

/**
 * Exercises the full collection path against a real database and object store.
 * Both must be configured, not just the database - guarding on DATABASE_URL
 * alone made this fail with a DNS error when only MariaDB was up, which reads
 * like a code fault rather than a missing service:
 *   DATABASE_URL=mysql://... OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9010 \
 *     pnpm vitest run tests/sequence-upload-integration.test.ts
 */
const configured = !!process.env.DATABASE_URL && !!process.env.OBJECT_STORAGE_ENDPOINT;

describe.skipIf(!configured)("collection path", () => {
  beforeAll(async () => {
    const db = (await getDb())!;
    await db.delete(captureSessions).where(eq(captureSessions.signerId, SIGNER));
    await db.delete(consentRecords).where(eq(consentRecords.signerId, SIGNER));
    await seedSentencePrompts();
    await grantConsent({ signerId: SIGNER, consentVersion: "v1", scopes: ["participation"] });
  });

  it("seeds all one hundred prompts", async () => {
    const result = await seedSentencePrompts();
    expect(result.seeded).toBe(100);
  });

  it("serves a first prompt and reports zero progress", async () => {
    const next = await getNextPromptForSigner(SIGNER);
    expect(next).not.toBeNull();
    expect(next!.progress).toEqual({ completed: 0, total: 100 });
  });

  it("stores a sequence, tags it, and advances progress", async () => {
    const db = (await getDb())!;
    const first = (await getNextPromptForSigner(SIGNER))!;
    const session = await startCaptureSession({ signerId: SIGNER, promptId: first.id });
    expect((await getCaptureSession(session.id))!.status).toBe("recording");

    // Thirty neutral frames to establish the baseline, then a sustained tilt.
    const frames = [
      ...makeNeutralSequence(30),
      ...Array.from({ length: 30 }, (_, i) =>
        makePoseFrame(Math.round((30 + i) * (1000 / 30)), {
          shoulderL: [0.4, 0.44, 0],
          shoulderR: [0.6, 0.56, 0],
        }),
      ),
    ];

    const payload: LandmarkSequencePayload = {
      schemaVersion: 1,
      sessionId: session.id,
      promptId: first.id,
      category: first.category,
      extractorId: "fixture@1",
      targetFps: 30,
      achievedFps: 30,
      frameCount: frames.length,
      durationMs: frames[frames.length - 1].t,
      frames,
    };

    const body = gzipSync(Buffer.from(JSON.stringify(payload)));
    const key = sequenceObjectKey({ signerId: SIGNER, sessionId: session.id });
    const stored = await putLandmarkSequence({ key, data: body });
    expect(stored.key).toBe(key);
    expect(stored.sizeBytes).toBeGreaterThan(0);
    expect(stored.storageDriver).toBe("minio");

    const baseline = computeSignerBaseline(frames)!;
    const detections = detectNmms(frames, { baseline });
    await storeSequenceForSession({
      sessionId: session.id,
      payload,
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      detections,
    });

    expect((await getCaptureSession(session.id))!.status).toBe("stored");

    const seqRows = await db
      .select()
      .from(landmarkSequences)
      .where(eq(landmarkSequences.sessionId, session.id));
    expect(seqRows).toHaveLength(1);
    expect(seqRows[0].extractorId).toBe("fixture@1");
    expect(seqRows[0].storageKey).not.toMatch(/\.mp4$/);

    // Exactly one marker, of the type the movement encodes, starting where the
    // movement starts. Asserting only "at least one tag" would pass even if
    // every rule fired at once on a meaningless baseline.
    const tagRows = await db.select().from(nmmTags).where(eq(nmmTags.sessionId, session.id));
    expect(tagRows.map((t) => t.type)).toEqual(["body_tilt"]);
    expect(tagRows[0].startFrame).toBeGreaterThanOrEqual(30);
    expect(tagRows[0].confidenceBp).toBeGreaterThan(0);
    expect(tagRows[0].confidenceBp).toBeLessThanOrEqual(10_000);
    expect(tagRows[0].ruleVersion).toBe("baseline-v1");

    const progress = await getSignerProgress(SIGNER);
    expect(progress.completed).toBe(1);
    expect(progress.byCategory[first.category]).toBe(1);
  });

  it("does not serve the same prompt twice", async () => {
    const progress = await getSignerProgress(SIGNER);
    const next = await getNextPromptForSigner(SIGNER);
    expect(progress.completedPromptIds).not.toContain(next!.id);
  });

  it("counts a skip as handled without counting it as completed", async () => {
    const before = await getSignerProgress(SIGNER);
    const next = (await getNextPromptForSigner(SIGNER))!;
    await skipPrompt({ signerId: SIGNER, promptId: next.id, reason: "lighting too poor" });
    const after = await getSignerProgress(SIGNER);
    expect(after.skipped).toBe(before.skipped + 1);
    expect(after.completed).toBe(before.completed);
    expect((await getNextPromptForSigner(SIGNER))!.id).not.toBe(next.id);
  });

  it("supersedes the previous stored session on a redo", async () => {
    const db = (await getDb())!;
    // Self-contained: relying on an earlier test's stored session made this
    // fail with "Unknown prompt: undefined" whenever that test was skipped.
    const done = "C-05";
    const first = await startCaptureSession({ signerId: SIGNER, promptId: done });
    await storeSequenceForSession({
      sessionId: first.id,
      payload: {
        schemaVersion: 1,
        sessionId: first.id,
        promptId: done,
        category: "negation",
        extractorId: "fixture@1",
        targetFps: 30,
        achievedFps: 30,
        frameCount: 1,
        durationMs: 33,
        frames: [],
      },
      storageKey: `sequences/signer-${SIGNER}/${first.id}.json.gz`,
      sizeBytes: 10,
      detections: [],
    });

    await startCaptureSession({ signerId: SIGNER, promptId: done });
    const rows = await db
      .select()
      .from(captureSessions)
      .where(eq(captureSessions.promptId, done));
    const mine = rows.filter((r) => r.signerId === SIGNER);
    expect(mine.filter((r) => r.status === "superseded")).toHaveLength(1);
    expect(mine.filter((r) => r.status === "recording")).toHaveLength(1);
  });
});
