import type { CorpusCategory } from "../shared/corpus";
import type { NmmType } from "../shared/workflow";
import type { Split } from "./split-service";

export type ExportRow = {
  sessionId: string;
  signerId: number;
  promptId: string;
  category: CorpusCategory;
  textEnglish: string;
  storageKey: string;
  extractorId: string;
  frameCount: number;
  durationMs: number;
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
export function buildElanTiers(row: ExportRow & { achievedFps: number }): ElanTier[] {
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
