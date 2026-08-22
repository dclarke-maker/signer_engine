import { describe, expect, it } from "vitest";

import { SPLIT_RATIOS, assignSplits, hashToUnit } from "../server/split-service";
import { corpusSeed } from "../server/corpus-seed";
import { CORPUS_CATEGORIES } from "../shared/corpus";
import { buildElanTiers, buildTrainingJsonl, exportManifest } from "../server/export-service";
import type { ExportRow } from "../server/export-service";

const signers = Array.from({ length: 35 }, (_, i) => i + 1);

describe("split ratios", () => {
  it("uses the proposal's 70 / 15 / 15 partition", () => {
    expect(SPLIT_RATIOS).toEqual({ train: 0.7, validation: 0.15, test: 0.15 });
  });
});

describe("signer-independent assignment", () => {
  it("places every signer in exactly one split", () => {
    const assigned = assignSplits(signers, "study-seed-1");
    expect(assigned).toHaveLength(signers.length);
    expect(new Set(assigned.map((a) => a.signerId)).size).toBe(signers.length);
  });

  it("approximates the target ratios", () => {
    const assigned = assignSplits(signers, "study-seed-1");
    const count = (split: string) => assigned.filter((a) => a.split === split).length;
    expect(count("train")).toBeGreaterThanOrEqual(22);
    expect(count("train")).toBeLessThanOrEqual(26);
    expect(count("validation")).toBeGreaterThanOrEqual(4);
    expect(count("test")).toBeGreaterThanOrEqual(4);
    expect(count("train") + count("validation") + count("test")).toBe(signers.length);
  });

  it("is reproducible for the same seed and unstable across seeds", () => {
    expect(assignSplits(signers, "seed-a")).toEqual(assignSplits(signers, "seed-a"));
    expect(assignSplits(signers, "seed-a")).not.toEqual(assignSplits(signers, "seed-b"));
  });

  it("records the seed on every assignment so the partition stays traceable", () => {
    for (const a of assignSplits(signers, "study-seed-1")) expect(a.seed).toBe("study-seed-1");
  });

  it("handles a roster too small to fill every split without crashing", () => {
    const tiny = assignSplits([1, 2], "seed-a");
    expect(tiny).toHaveLength(2);
    expect(new Set(tiny.map((a) => a.signerId)).size).toBe(2);
  });

  it("never leaves validation or test empty once three signers exist", () => {
    // Plain rounding starves the smaller splits on modest rosters - five
    // signers round to 4/1/0, and an empty test split means no held-out
    // evaluation at all, which silently invalidates every reported metric.
    for (const size of [3, 4, 5, 6, 7, 8, 10, 12]) {
      const roster = Array.from({ length: size }, (_, i) => i + 1);
      const assigned = assignSplits(roster, "seed-a");
      for (const split of ["train", "validation", "test"] as const) {
        expect(
          assigned.filter((a) => a.split === split).length,
          `${split} was empty for a roster of ${size}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("still approximates the target ratios at study scale", () => {
    const assigned = assignSplits(signers, "study-seed-1");
    const share = (s: string) => assigned.filter((a) => a.split === s).length / signers.length;
    expect(share("train")).toBeGreaterThan(0.6);
    expect(share("train")).toBeLessThan(0.78);
  });

  it("carries every category into every split in equal proportion", () => {
    // Each signer records the full corpus, so partitioning by signer is
    // stratified by construction. This checks the resulting corpus, not the
    // arithmetic: build the sessions each split implies and compare shares.
    const assigned = assignSplits(signers, "study-seed-1");
    const sessionsFor = (split: string) =>
      assigned
        .filter((a) => a.split === split)
        .flatMap((a) => corpusSeed.map((p) => ({ signerId: a.signerId, category: p.category })));

    for (const split of ["train", "validation", "test"] as const) {
      const sessions = sessionsFor(split);
      expect(sessions.length).toBeGreaterThan(0);
      for (const category of CORPUS_CATEGORIES) {
        const share = sessions.filter((x) => x.category === category).length / sessions.length;
        expect(share).toBeCloseTo(1 / CORPUS_CATEGORIES.length, 10);
      }
    }
  });

  it("puts no signer in more than one split, so evaluation stays unseen", () => {
    const assigned = assignSplits(signers, "study-seed-1");
    const bySigner = new Map<number, Set<string>>();
    for (const a of assigned) {
      const set = bySigner.get(a.signerId) ?? new Set<string>();
      set.add(a.split);
      bySigner.set(a.signerId, set);
    }
    for (const splits of bySigner.values()) expect(splits.size).toBe(1);
  });

  it("maps a value into the unit interval deterministically", () => {
    const u = hashToUnit("signer-7");
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
    expect(hashToUnit("signer-7")).toBe(u);
  });
});

describe("exports", () => {
  const row: ExportRow = {
    sessionId: "s-1",
    signerId: 7,
    promptId: "B-02",
    category: "interrogative",
    textEnglish: "Where is the hospital?",
    textNepali: "अस्पताल कहाँ छ?",
    storageKey: "sequences/signer-7/s-1.json.gz",
    extractorId: "fixture@1",
    frameCount: 120,
    durationMs: 4000,
    achievedFps: 30,
    split: "train",
    nmmTags: [
      {
        type: "eyebrow_raise",
        startFrame: 10,
        endFrame: 40,
        confidence: 0.8,
        ruleVersion: "baseline-v1",
      },
    ],
  };

  it("emits one JSON object per line, carrying provenance", () => {
    const lines = buildTrainingJsonl([row]).trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.text).toBe("Where is the hospital?");
    expect(parsed.category).toBe("interrogative");
    expect(parsed.extractorId).toBe("fixture@1");
    expect(parsed.split).toBe("train");
    expect(parsed.nmm[0].type).toBe("eyebrow_raise");
    expect(parsed.nmm[0].ruleVersion).toBe("baseline-v1");
  });

  it("never leaks a video reference into an export", () => {
    expect(buildTrainingJsonl([row])).not.toMatch(/\.mp4|video/i);
  });

  it("stays parseable line by line for a multi-row export", () => {
    const jsonl = buildTrainingJsonl([row, { ...row, sessionId: "s-2", split: "test" }]);
    const parsed = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.split)).toEqual(["train", "test"]);
  });

  it("builds ELAN tiers with temporal boundaries in milliseconds", () => {
    const tiers = buildElanTiers(row);
    const sentence = tiers.find((t) => t.tier === "sentence")!;
    expect(sentence.annotations[0]).toEqual({
      start: 0,
      end: 4000,
      value: "Where is the hospital?",
    });
    const nmm = tiers.find((t) => t.tier === "nmm")!;
    expect(nmm.annotations[0]).toEqual({ start: 333, end: 1333, value: "eyebrow_raise" });
  });

  it("does not emit nonsense boundaries when the frame rate is unknown", () => {
    const tiers = buildElanTiers({ ...row, achievedFps: 0 });
    const nmm = tiers.find((t) => t.tier === "nmm")!;
    expect(nmm.annotations[0]).toEqual({ start: 0, end: 0, value: "eyebrow_raise" });
  });

  it("stamps a manifest with the seed, versions, and consent state", () => {
    const manifest = exportManifest({
      seed: "study-seed-1",
      ruleVersion: "baseline-v1",
      extractorId: "fixture@1",
      consentVersion: "v1",
      rowCount: 1,
      generatedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(manifest).toMatchObject({
      seed: "study-seed-1",
      ruleVersion: "baseline-v1",
      consentVersion: "v1",
      rowCount: 1,
    });
  });
});
