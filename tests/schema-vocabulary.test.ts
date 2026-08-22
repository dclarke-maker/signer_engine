import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";

import {
  captureSessions,
  feedbackVotes,
  nmmTags,
  qualitativeRatings,
  sentencePrompts,
  translationJobs,
} from "../drizzle/schema";
import { CORPUS_CATEGORIES } from "../shared/corpus";
import {
  feedbackVoteValues,
  nmmTypes,
  sessionStatuses,
  translationStatuses,
} from "../shared/workflow";

function enumValues(table: unknown, columnName: string): readonly string[] {
  const column = getTableConfig(table as never).columns.find((c) => c.name === columnName);
  if (!column) throw new Error(`No column named ${columnName}`);
  return (column as unknown as { enumValues: readonly string[] }).enumValues;
}

function columnNames(table: unknown): string[] {
  return getTableConfig(table as never).columns.map((c) => c.name);
}

describe("schema enums track the shared vocabularies", () => {
  it("uses the shared session status list", () => {
    expect(enumValues(captureSessions, "status")).toEqual([...sessionStatuses]);
  });

  it("uses the shared corpus categories", () => {
    expect(enumValues(sentencePrompts, "category")).toEqual([...CORPUS_CATEGORIES]);
    expect(enumValues(captureSessions, "category")).toEqual([...CORPUS_CATEGORIES]);
  });

  it("uses the shared translation status list", () => {
    expect(enumValues(translationJobs, "status")).toEqual([...translationStatuses]);
  });

  it("uses the shared vote and marker lists", () => {
    expect(enumValues(feedbackVotes, "vote")).toEqual([...feedbackVoteValues]);
    expect(enumValues(nmmTags, "type")).toEqual([...nmmTypes]);
  });

  it("stores the three Likert scales as separate columns", () => {
    expect(columnNames(qualitativeRatings)).toEqual(
      expect.arrayContaining(["naturalness", "grammaticality", "usefulness"]),
    );
  });

  it("records the model version on every translation job", () => {
    const column = getTableConfig(translationJobs as never).columns.find(
      (c) => c.name === "modelVersion",
    );
    expect(column?.notNull).toBe(true);
  });

  it("stores confidence as basis points, never as a float", () => {
    expect(columnNames(nmmTags)).toContain("confidenceBp");
    expect(columnNames(nmmTags)).not.toContain("confidence");
  });

  it("retires the video-oriented capture table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).not.toHaveProperty("signerCaptures");
  });
});
