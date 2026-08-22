import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { feedbackVotes, qualitativeRatings } from "../drizzle/schema";
import { getDb } from "../server/db";
import { recordFeedbackVote, recordQualitativeRating } from "../server/feedback-service";

/** Skipped unless DATABASE_URL points at a migrated database. */
describe.skipIf(!process.env.DATABASE_URL)("feedback persistence", () => {
  const JOB = "feedback-integration-job";

  it("persists a vote and revises rather than duplicating on re-vote", async () => {
    const db = (await getDb())!;
    await db.delete(feedbackVotes).where(eq(feedbackVotes.translationJobId, JOB));

    await recordFeedbackVote({
      translationJobId: JOB,
      signerId: 91,
      vote: "needs_correction",
      note: "  The final phrase is missing.  ",
    });
    let rows = await db.select().from(feedbackVotes).where(eq(feedbackVotes.translationJobId, JOB));
    expect(rows).toHaveLength(1);
    expect(rows[0].vote).toBe("needs_correction");
    expect(rows[0].note).toBe("The final phrase is missing.");

    await recordFeedbackVote({ translationJobId: JOB, signerId: 91, vote: "accurate" });
    rows = await db.select().from(feedbackVotes).where(eq(feedbackVotes.translationJobId, JOB));
    expect(rows).toHaveLength(1);
    expect(rows[0].vote).toBe("accurate");
    expect(rows[0].note).toBeNull();

    await db.delete(feedbackVotes).where(eq(feedbackVotes.translationJobId, JOB));
  });

  it("keeps different signers' votes on the same job separate", async () => {
    const db = (await getDb())!;
    await db.delete(feedbackVotes).where(eq(feedbackVotes.translationJobId, JOB));

    await recordFeedbackVote({ translationJobId: JOB, signerId: 91, vote: "accurate" });
    await recordFeedbackVote({ translationJobId: JOB, signerId: 92, vote: "needs_correction" });
    const rows = await db
      .select()
      .from(feedbackVotes)
      .where(eq(feedbackVotes.translationJobId, JOB));
    expect(rows).toHaveLength(2);

    await db.delete(feedbackVotes).where(eq(feedbackVotes.translationJobId, JOB));
  });

  it("persists the three Likert scales and revises on re-rate", async () => {
    const db = (await getDb())!;
    await db.delete(qualitativeRatings).where(eq(qualitativeRatings.translationJobId, JOB));

    await recordQualitativeRating({
      translationJobId: JOB,
      signerId: 91,
      naturalness: 4,
      grammaticality: 3,
      usefulness: 5,
    });
    let rows = await db
      .select()
      .from(qualitativeRatings)
      .where(eq(qualitativeRatings.translationJobId, JOB));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ naturalness: 4, grammaticality: 3, usefulness: 5 });

    await recordQualitativeRating({
      translationJobId: JOB,
      signerId: 91,
      naturalness: 2,
      grammaticality: 2,
      usefulness: 1,
    });
    rows = await db
      .select()
      .from(qualitativeRatings)
      .where(eq(qualitativeRatings.translationJobId, JOB));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ naturalness: 2, grammaticality: 2, usefulness: 1 });

    await db.delete(qualitativeRatings).where(eq(qualitativeRatings.translationJobId, JOB));
  });

  it("refuses an out-of-range rating before touching the database", async () => {
    await expect(
      recordQualitativeRating({
        translationJobId: JOB,
        signerId: 91,
        naturalness: 9,
        grammaticality: 3,
        usefulness: 3,
      }),
    ).rejects.toThrow(/naturalness must be an integer/i);
  });
});
