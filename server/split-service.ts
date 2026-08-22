import { createHash } from "node:crypto";

import { splitAssignments } from "../drizzle/schema";
import { getDb } from "./db";

export const SPLIT_RATIOS = { train: 0.7, validation: 0.15, test: 0.15 } as const;
export type Split = keyof typeof SPLIT_RATIOS;

/** Deterministic map from any string into [0, 1). */
export function hashToUnit(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

export type SplitAssignmentResult = { signerId: number; split: Split; seed: string };

/**
 * Splits by signer, not by sample, so the model is always evaluated on entirely
 * unseen individuals and signer-specific idiosyncrasies cannot inflate the
 * metrics. Seeded and recorded so the partition is reproducible.
 * See design.md §12.3.
 */
export function assignSplits(signerIds: number[], seed: string): SplitAssignmentResult[] {
  const ordered = [...signerIds].sort(
    (a, b) => hashToUnit(`${seed}:${a}`) - hashToUnit(`${seed}:${b}`),
  );

  const total = ordered.length;
  const trainCount = Math.round(total * SPLIT_RATIOS.train);
  const validationCount = Math.round(total * SPLIT_RATIOS.validation);

  return ordered.map((signerId, index) => ({
    signerId,
    split:
      index < trainCount ? "train" : index < trainCount + validationCount ? "validation" : "test",
    seed,
  }));
}

export async function persistSplitAssignments(assignments: SplitAssignmentResult[]) {
  const db = await getDb();
  if (!db) throw new Error("The split database is not configured.");
  for (const assignment of assignments) {
    await db
      .insert(splitAssignments)
      .values(assignment)
      .onDuplicateKeyUpdate({ set: { split: assignment.split, seed: assignment.seed } });
  }
  return { assigned: assignments.length };
}
