import { and, eq, isNull } from "drizzle-orm";

import {
  captureSessions,
  consentRecords,
  landmarkSequences,
  nmmTags,
  splitAssignments,
} from "../drizzle/schema";
import { corpusSeed } from "./corpus-seed";
import { getDb } from "./db";
import { CURRENT_CONSENT_VERSION } from "./consent-service";
import type { CorpusCategory } from "../shared/corpus";
import type { NmmType } from "../shared/workflow";
import type { Split } from "./split-service";

export type ExportRow = {
  sessionId: string;
  signerId: number;
  promptId: string;
  category: CorpusCategory;
  textEnglish: string;
  /** What the signer actually read. Kept so a mismatch stays auditable. */
  textNepali: string;
  storageKey: string;
  extractorId: string;
  frameCount: number;
  durationMs: number;
  /** Needed to convert NMM frame boundaries into ELAN's milliseconds. */
  achievedFps: number;
  split: Split;
  nmmTags: {
    type: NmmType;
    startFrame: number;
    endFrame: number;
    confidence: number;
    ruleVersion: string;
  }[];
};

/**
 * One JSON object per line. Carries the sequence reference and its provenance -
 * never a media file. See design.md §12.4.
 */
export function buildTrainingJsonl(rows: ExportRow[]): string {
  return rows
    .map((row) =>
      JSON.stringify({
        sessionId: row.sessionId,
        signerId: row.signerId,
        split: row.split,
        promptId: row.promptId,
        category: row.category,
        text: row.textEnglish,
        textNepali: row.textNepali,
        sequence: row.storageKey,
        extractorId: row.extractorId,
        frameCount: row.frameCount,
        durationMs: row.durationMs,
        nmm: row.nmmTags.map((tag) => ({
          type: tag.type,
          startFrame: tag.startFrame,
          endFrame: tag.endFrame,
          confidence: tag.confidence,
          ruleVersion: tag.ruleVersion,
        })),
      }),
    )
    .join("\n")
    .concat("\n");
}

export type ElanTier = {
  tier: "sentence" | "nmm";
  annotations: { start: number; end: number; value: string }[];
};

/**
 * Sentence-level tiers with millisecond boundaries, so the linguistic team can
 * inspect and correct heuristic output in ELAN.
 */
export function buildElanTiers(row: ExportRow): ElanTier[] {
  // An unknown frame rate yields zero-width annotations rather than invented
  // timings - a wrong boundary is worse than a visibly empty one.
  const msPerFrame = row.achievedFps > 0 ? 1000 / row.achievedFps : 0;
  return [
    {
      tier: "sentence",
      annotations: [{ start: 0, end: row.durationMs, value: row.textEnglish }],
    },
    {
      tier: "nmm",
      annotations: row.nmmTags.map((tag) => ({
        start: Math.round(tag.startFrame * msPerFrame),
        end: Math.round(tag.endFrame * msPerFrame),
        value: tag.type,
      })),
    },
  ];
}

export type ExportManifest = {
  seed: string;
  ruleVersion: string;
  extractorId: string;
  consentVersion: string;
  rowCount: number;
  generatedAt: string;
};

/** Provenance travels with the data; without it a result is unreproducible. */
export function exportManifest(input: ExportManifest): ExportManifest {
  return { ...input };
}


/**
 * Assembles the exportable corpus.
 *
 * Only `stored` sessions are included: `superseded` rows are kept for audit but
 * are no longer canonical, and `skipped` ones have no sequence. Signers without
 * a current consent grant are excluded here, in the query, so a withdrawal
 * cannot survive by being filtered downstream and forgotten.
 */
export async function collectExportRows(): Promise<ExportRow[]> {
  const db = await getDb();
  if (!db) throw new Error("The export database is not configured.");

  const consented = new Set(
    (
      await db
        .select({ signerId: consentRecords.signerId, version: consentRecords.consentVersion })
        .from(consentRecords)
        .where(isNull(consentRecords.withdrawnAt))
    )
      .filter((r) => r.version === CURRENT_CONSENT_VERSION)
      .map((r) => r.signerId),
  );

  const splits = new Map(
    (await db.select().from(splitAssignments)).map((r) => [r.signerId, r.split as Split]),
  );

  const rows = await db
    .select({
      session: captureSessions,
      sequence: landmarkSequences,
    })
    .from(captureSessions)
    .innerJoin(landmarkSequences, eq(landmarkSequences.sessionId, captureSessions.id))
    .where(eq(captureSessions.status, "stored"));

  const tags = await db.select().from(nmmTags);
  const tagsBySession = new Map<string, ExportRow["nmmTags"]>();
  for (const tag of tags) {
    const list = tagsBySession.get(tag.sessionId) ?? [];
    list.push({
      type: tag.type as NmmType,
      startFrame: tag.startFrame,
      endFrame: tag.endFrame,
      confidence: tag.confidenceBp / 10_000,
      ruleVersion: tag.ruleVersion,
    });
    tagsBySession.set(tag.sessionId, list);
  }

  const promptText = new Map(corpusSeed.map((p) => [p.id, p]));

  return rows
    .filter((r) => consented.has(r.session.signerId))
    .map(({ session, sequence }) => ({
      sessionId: session.id,
      signerId: session.signerId,
      promptId: session.promptId,
      category: session.category as CorpusCategory,
      textEnglish: promptText.get(session.promptId)?.textEnglish ?? "",
      textNepali: promptText.get(session.promptId)?.textNepali ?? "",
      storageKey: sequence.storageKey,
      extractorId: sequence.extractorId,
      frameCount: sequence.frameCount,
      durationMs: sequence.durationMs,
      achievedFps: sequence.achievedFps,
      split: splits.get(session.signerId) ?? "train",
      nmmTags: tagsBySession.get(session.id) ?? [],
    }));
}
