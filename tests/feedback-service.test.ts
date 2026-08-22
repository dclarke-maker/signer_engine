import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import {
  LIKERT_MAX,
  LIKERT_MIN,
  isValidLikert,
  normalizeFeedbackNote,
} from "../server/feedback-service";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("feedback note normalization", () => {
  it("trims a note and keeps its content", () => {
    expect(normalizeFeedbackNote("  The final phrase is missing.  ")).toBe(
      "The final phrase is missing.",
    );
  });

  it("treats an empty or whitespace note as absent", () => {
    expect(normalizeFeedbackNote("   ")).toBeNull();
    expect(normalizeFeedbackNote(undefined)).toBeNull();
    expect(normalizeFeedbackNote(null)).toBeNull();
  });

  it("truncates a note to the stored column width", () => {
    expect(normalizeFeedbackNote("x".repeat(400))).toHaveLength(280);
  });
});

describe("Likert validation", () => {
  it("accepts the full 1 to 5 range", () => {
    expect(LIKERT_MIN).toBe(1);
    expect(LIKERT_MAX).toBe(5);
    for (let v = LIKERT_MIN; v <= LIKERT_MAX; v += 1) expect(isValidLikert(v)).toBe(true);
  });

  it("rejects out-of-range and non-integer scores", () => {
    expect(isValidLikert(0)).toBe(false);
    expect(isValidLikert(6)).toBe(false);
    expect(isValidLikert(3.5)).toBe(false);
    expect(isValidLikert(Number.NaN)).toBe(false);
  });
});

describe("feedback router", () => {
  it("rejects a vote outside the directional vocabulary", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      // @ts-expect-error deliberately invalid vote
      caller.feedback.submit({ translationJobId: "j-1", vote: "maybe" }),
    ).rejects.toThrow();
  });

  it("rejects a Likert score outside 1 to 5", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.feedback.rate({
        translationJobId: "j-1",
        naturalness: 7,
        grammaticality: 3,
        usefulness: 3,
      }),
    ).rejects.toThrow();
  });

  it("rejects a note beyond the stored width", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.feedback.submit({
        translationJobId: "j-1",
        vote: "accurate",
        note: "x".repeat(400),
      }),
    ).rejects.toThrow();
  });

});

/**
 * These assert the no-database behaviour, so they only hold when there is no
 * database. Guarding on the absence of DATABASE_URL keeps them from failing
 * against a live one, where the correct outcome is the opposite.
 */
describe.skipIf(!!process.env.DATABASE_URL)("feedback without a database", () => {
  it("surfaces a clean error rather than silently dropping research data", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.feedback.submit({ translationJobId: "j-1", vote: "accurate" }),
    ).rejects.toThrow(/could not be recorded/i);
  });

  it("accepts a directional vote with no ratings, so scales never block it", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    // Reaching the database layer is the proof it passed validation.
    await expect(
      caller.feedback.submit({ translationJobId: "j-1", vote: "needs_correction" }),
    ).rejects.toThrow(/could not be recorded/i);
  });
});
