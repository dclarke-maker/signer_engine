/**
 * Writes the research corpus out for ELAN annotation and model training.
 *
 *   DATABASE_URL=mysql://... pnpm export:corpus [outputDir]
 *
 * Produces, per design.md §12.4:
 *   train.jsonl / validation.jsonl / test.jsonl  one JSON object per session
 *   elan/<sessionId>.json                        sentence and NMM tiers
 *   manifest.json                                seed, versions, consent state
 *
 * Nothing here reads or writes a media file. Rows carry the object-storage key
 * of a landmark sequence, never its contents.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BASELINE_RULE_VERSION } from "../server/nmm/thresholds";
import { CURRENT_CONSENT_VERSION } from "../server/consent-service";
import { buildElanTiers, buildTrainingJsonl, collectExportRows, exportManifest } from "../server/export-service";
import type { Split } from "../server/split-service";

const SPLITS: Split[] = ["train", "validation", "test"];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required. Nothing was written.");
    process.exit(1);
  }

  const outDir = process.argv[2] ?? "exports";
  const rows = await collectExportRows();

  if (rows.length === 0) {
    // Not an error: a study can legitimately have no exportable sessions yet.
    // Saying so beats writing three empty files and looking successful.
    console.warn("No exportable sessions found. Nothing was written.");
    return;
  }

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "elan"), { recursive: true });

  const counts: Record<string, number> = {};
  for (const split of SPLITS) {
    const forSplit = rows.filter((r) => r.split === split);
    counts[split] = forSplit.length;
    writeFileSync(join(outDir, `${split}.jsonl`), buildTrainingJsonl(forSplit), "utf8");
  }

  for (const row of rows) {
    writeFileSync(
      join(outDir, "elan", `${row.sessionId}.json`),
      JSON.stringify(buildElanTiers(row), null, 2),
      "utf8",
    );
  }

  const manifest = exportManifest({
    seed: process.env.STUDY_SPLIT_SEED ?? "unset",
    ruleVersion: BASELINE_RULE_VERSION,
    extractorId: [...new Set(rows.map((r) => r.extractorId))].join(","),
    consentVersion: CURRENT_CONSENT_VERSION,
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
  });
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const signers = new Set(rows.map((r) => r.signerId)).size;
  console.log(`Exported ${rows.length} sessions from ${signers} signers to ${outDir}/`);
  for (const split of SPLITS) console.log(`  ${split.padEnd(11)} ${counts[split]}`);

  // An empty split is not a formatting quirk: no held-out signers means no
  // valid evaluation, and a silent zero here would be reported as a result.
  const empty = SPLITS.filter((s) => counts[s] === 0);
  if (empty.length > 0) {
    console.warn(
      `\n  WARNING: ${empty.join(" and ")} contain no sessions. ` +
        "Metrics computed against an empty split are meaningless. " +
        "Check that enough signers have contributed and that splits were assigned.",
    );
  }
  if (manifest.seed === "unset") {
    console.warn(
      "  STUDY_SPLIT_SEED was not set, so the manifest cannot record which seed produced this partition.",
    );
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
