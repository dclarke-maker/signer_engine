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
  let trainCount = Math.round(total * SPLIT_RATIOS.train);
  let validationCount = Math.round(total * SPLIT_RATIOS.validation);

  // Plain rounding starves the smaller splits on modest rosters - five signers
  // round to 4/1/0. An empty test split means no held-out evaluation at all,
  // which would invalidate every reported metric without any visible failure,
  // so once there are enough signers to fill three splits, each gets at least
  // one. At study scale (30-40) this never binds.
  if (total >= 3) {
    validationCount = Math.max(1, validationCount);
    if (total - trainCount - validationCount < 1) {
      trainCount = total - validationCount - 1;
    }
  }

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
