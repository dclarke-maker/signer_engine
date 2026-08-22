import { describe, expect, it } from "vitest";

import { splitAssignments } from "../drizzle/schema";
import { getDb } from "../server/db";
import { assignSplits, persistSplitAssignments } from "../server/split-service";

/** Skipped unless DATABASE_URL points at a migrated database. */
describe.skipIf(!process.env.DATABASE_URL)("split persistence", () => {
  it("persists one row per signer and is idempotent under re-seeding", async () => {
    const db = (await getDb())!;
    await db.delete(splitAssignments);

    const roster = Array.from({ length: 35 }, (_, i) => i + 1);
    await persistSplitAssignments(assignSplits(roster, "study-seed-1"));
    let rows = await db.select().from(splitAssignments);
    expect(rows).toHaveLength(35);
    expect(rows.every((r) => r.seed === "study-seed-1")).toBe(true);

    // Re-running with a new seed revises in place rather than duplicating.
    await persistSplitAssignments(assignSplits(roster, "study-seed-2"));
    rows = await db.select().from(splitAssignments);
    expect(rows).toHaveLength(35);
    expect(rows.every((r) => r.seed === "study-seed-2")).toBe(true);

    const counts = { train: 0, validation: 0, test: 0 } as Record<string, number>;
    for (const r of rows) counts[r.split] += 1;
    expect(counts.train + counts.validation + counts.test).toBe(35);
    expect(counts.train).toBeGreaterThan(counts.validation);

    await db.delete(splitAssignments);
  });
});
