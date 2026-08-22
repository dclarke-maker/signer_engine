import { and, eq, inArray } from "drizzle-orm";

import { captureSessions, landmarkSequences, nmmTags, sentencePrompts } from "../drizzle/schema";
import { corpusSeed } from "./corpus-seed";
import { getDb } from "./db";
import type { NmmDetection } from "./nmm/rules";
import { CORPUS_SIZE, type CorpusCategory } from "../shared/corpus";
import type { LandmarkSequencePayload } from "../shared/landmarks";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The session database is not configured.");
  return db;
}

/**
 * Seeded per-signer prompt order. A partial contribution must stay balanced
 * across categories rather than concentrating in Category A, so the order
 * interleaves the five categories and is stable for a given signer.
 */
export function promptOrderForSigner(signerId: number): string[] {
  const byCategory = new Map<CorpusCategory, string[]>();
  for (const prompt of corpusSeed) {
    const list = byCategory.get(prompt.category) ?? [];
    list.push(prompt.id);
    byCategory.set(prompt.category, list);
  }

  const categories = [...byCategory.keys()];
  const rotation = signerId % categories.length;
  const rotated = [...categories.slice(rotation), ...categories.slice(0, rotation)];

  const order: string[] = [];
  for (let i = 0; i < CORPUS_SIZE; i += 1) {
    const category = rotated[i % rotated.length];
    const slot = Math.floor(i / rotated.length);
    const id = byCategory.get(category)?.[slot];
    if (id) order.push(id);
  }
  return order;
}

export async function getCaptureSession(sessionId: string) {
  const db = await requireDb();
  const row = (
    await db.select().from(captureSessions).where(eq(captureSessions.id, sessionId)).limit(1)
  )[0];
  return row ?? null;
}

export async function getSignerProgress(signerId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(captureSessions)
    .where(
      and(
        eq(captureSessions.signerId, signerId),
        inArray(captureSessions.status, ["stored", "skipped"]),
      ),
    );

  const completedPromptIds = new Set(
    rows.filter((r) => r.status === "stored").map((r) => r.promptId),
  );
  const skippedPromptIds = new Set(
    rows.filter((r) => r.status === "skipped").map((r) => r.promptId),
  );

  const byCategory: Record<string, number> = {};
  for (const prompt of corpusSeed) {
    if (completedPromptIds.has(prompt.id)) {
      byCategory[prompt.category] = (byCategory[prompt.category] ?? 0) + 1;
    }
  }

  return {
    completed: completedPromptIds.size,
    skipped: skippedPromptIds.size,
    total: CORPUS_SIZE,
    byCategory,
    completedPromptIds: [...completedPromptIds],
    skippedPromptIds: [...skippedPromptIds],
  };
}

export async function getNextPromptForSigner(signerId: number) {
  const progress = await getSignerProgress(signerId);
  const done = new Set([...progress.completedPromptIds, ...progress.skippedPromptIds]);
  const nextId = promptOrderForSigner(signerId).find((id) => !done.has(id));
  if (!nextId) return null;
  const prompt = corpusSeed.find((p) => p.id === nextId)!;
  return { ...prompt, progress: { completed: progress.completed, total: progress.total } };
}

export async function startCaptureSession(input: { signerId: number; promptId: string }) {
  const db = await requireDb();
  const prompt = corpusSeed.find((p) => p.id === input.promptId);
  if (!prompt) throw new Error(`Unknown prompt: ${input.promptId}`);

  // A redo supersedes the previous stored session; the old one is kept for audit
  // but excluded from export.
  await db
    .update(captureSessions)
    .set({ status: "superseded" })
    .where(
      and(
        eq(captureSessions.signerId, input.signerId),
        eq(captureSessions.promptId, input.promptId),
        eq(captureSessions.status, "stored"),
      ),
    );

  const id = crypto.randomUUID();
  await db.insert(captureSessions).values({
    id,
    signerId: input.signerId,
    promptId: prompt.id,
    category: prompt.category,
    status: "recording",
  });

  return {
    id,
    promptId: prompt.id,
    category: prompt.category,
    textEnglish: prompt.textEnglish,
    textNepali: prompt.textNepali,
  };
}

export async function skipPrompt(input: { signerId: number; promptId: string; reason: string }) {
  const db = await requireDb();
  const prompt = corpusSeed.find((p) => p.id === input.promptId);
  if (!prompt) throw new Error(`Unknown prompt: ${input.promptId}`);

  const id = crypto.randomUUID();
  await db.insert(captureSessions).values({
    id,
    signerId: input.signerId,
    promptId: prompt.id,
    category: prompt.category,
    status: "skipped",
    skipReason: input.reason.slice(0, 256),
    completedAt: new Date(),
  });
  return { id, status: "skipped" as const };
}

export async function storeSequenceForSession(input: {
  sessionId: string;
  payload: LandmarkSequencePayload;
  storageKey: string;
  sizeBytes: number;
  detections: NmmDetection[];
}) {
  const db = await requireDb();

  await db.insert(landmarkSequences).values({
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    schemaVersion: input.payload.schemaVersion,
    extractorId: input.payload.extractorId,
    frameCount: input.payload.frameCount,
    targetFps: Math.round(input.payload.targetFps),
    achievedFps: Math.round(input.payload.achievedFps),
    durationMs: input.payload.durationMs,
    storageKey: input.storageKey,
    sizeBytes: input.sizeBytes,
  });

  if (input.detections.length > 0) {
    await db.insert(nmmTags).values(
      input.detections.map((d) => ({
        sessionId: input.sessionId,
        type: d.type,
        startFrame: d.startFrame,
        endFrame: d.endFrame,
        confidenceBp: Math.round(d.confidence * 10_000),
        ruleVersion: d.ruleVersion,
      })),
    );
  }

  await db
    .update(captureSessions)
    .set({ status: "stored", completedAt: new Date() })
    .where(eq(captureSessions.id, input.sessionId));

  return { sessionId: input.sessionId, status: "stored" as const };
}

export async function seedSentencePrompts() {
  const db = await requireDb();
  for (const prompt of corpusSeed) {
    await db
      .insert(sentencePrompts)
      .values({
        id: prompt.id,
        category: prompt.category,
        orderIndex: prompt.orderIndex,
        textEnglish: prompt.textEnglish,
        textNepali: prompt.textNepali,
        nepaliSource: prompt.nepaliSource,
        expectedNmms: JSON.stringify(prompt.expectedNmms),
      })
      .onDuplicateKeyUpdate({
        set: {
          textEnglish: prompt.textEnglish,
          textNepali: prompt.textNepali,
          nepaliSource: prompt.nepaliSource,
          expectedNmms: JSON.stringify(prompt.expectedNmms),
        },
      });
  }
  return { seeded: corpusSeed.length };
}
