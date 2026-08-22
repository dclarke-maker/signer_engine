import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { translationJobs } from "../drizzle/schema";
import { getDb } from "./db";

export const FIXTURE_MODEL_VERSION = "fixture@1";

export interface SignTranslator {
  readonly modelVersion: string;
  translate(input: { sequenceRef: string; frameCount: number }): Promise<{
    englishResponse: string;
    confidence: number;
  }>;
}

/**
 * Deterministic stand-in for the multi-stream Transformer. It exists so the full
 * contract - session, upload, job lifecycle, feedback, ratings, export - is
 * exercisable end to end before the model exists. See design.md §14.2.
 */
const FIXTURE_RESPONSES = [
  "I am going home.",
  "Where is the hospital?",
  "I do not understand.",
  "I went yesterday.",
  "I need a doctor now.",
  "Can you help me?",
];

export function createFixtureTranslator(): SignTranslator {
  return {
    modelVersion: FIXTURE_MODEL_VERSION,
    async translate({ sequenceRef, frameCount }) {
      const digest = createHash("sha256").update(sequenceRef).digest();
      const englishResponse = FIXTURE_RESPONSES[digest[0] % FIXTURE_RESPONSES.length];
      // Longer sequences read as marginally more confident. Capped below 1: the
      // system must never present an automated interpretation as definitive.
      const confidence = Math.min(0.95, 0.5 + Math.min(frameCount, 450) / 1000);
      return { englishResponse, confidence };
    },
  };
}

export function getTranslator(): SignTranslator {
  // Only the fixture translator exists today. When the multi-stream Transformer
  // ships, select it here on SIGN_TRANSLATOR_MODE and leave every caller alone.
  return createFixtureTranslator();
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The translation database is not configured.");
  return db;
}

export async function createTranslationJob(input: { sessionId: string; frameCount: number }) {
  const db = await requireDb();
  const translator = getTranslator();
  const id = crypto.randomUUID();
  const startedAt = Date.now();

  await db.insert(translationJobs).values({
    id,
    sessionId: input.sessionId,
    status: "processing",
    modelVersion: translator.modelVersion,
  });

  try {
    const result = await translator.translate({
      sequenceRef: input.sessionId,
      frameCount: input.frameCount,
    });
    const latencyMs = Date.now() - startedAt;

    await db
      .update(translationJobs)
      .set({
        status: "complete",
        englishResponse: result.englishResponse,
        confidenceBp: Math.round(result.confidence * 10_000),
        latencyMs,
        completedAt: new Date(),
      })
      .where(eq(translationJobs.id, id));

    return {
      id,
      status: "complete" as const,
      englishResponse: result.englishResponse,
      confidence: result.confidence,
      modelVersion: translator.modelVersion,
      latencyMs,
    };
  } catch (error) {
    // A failed job stays on the record. Deleting it would hide model failures
    // from exactly the metrics meant to measure them.
    await db
      .update(translationJobs)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(translationJobs.id, id));
    throw error;
  }
}

export async function getLatestTranslationJob(sessionId: string) {
  const db = await requireDb();
  const row = (
    await db
      .select()
      .from(translationJobs)
      .where(eq(translationJobs.sessionId, sessionId))
      .orderBy(desc(translationJobs.createdAt))
      .limit(1)
  )[0];
  return row ?? null;
}
