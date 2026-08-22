import { feedbackVotes, qualitativeRatings } from "../drizzle/schema";
import { getDb } from "./db";
import type { FeedbackVote } from "../shared/workflow";

export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;
const NOTE_MAX_LENGTH = 280;

export function normalizeFeedbackNote(note: string | undefined | null): string | null {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, NOTE_MAX_LENGTH);
}

export function isValidLikert(value: number): boolean {
  return Number.isInteger(value) && value >= LIKERT_MIN && value <= LIKERT_MAX;
}

async function requireDb() {
  const db = await getDb();
  // Feedback is research data. Dropping it silently would corrupt the study, so
  // the failure surfaces to the participant for retry rather than being swallowed.
  if (!db) throw new Error("Feedback could not be recorded. Please try again.");
  return db;
}

export async function recordFeedbackVote(input: {
  translationJobId: string;
  signerId: number | null;
  vote: FeedbackVote;
  note?: string;
}) {
  const db = await requireDb();
  const id = crypto.randomUUID();
  const note = normalizeFeedbackNote(input.note);

  // One standing vote per signer per job; re-voting revises rather than duplicates.
  await db
    .insert(feedbackVotes)
    .values({
      id,
      translationJobId: input.translationJobId,
      signerId: input.signerId,
      vote: input.vote,
      note,
    })
    .onDuplicateKeyUpdate({ set: { vote: input.vote, note } });

  return {
    id,
    status: "recorded" as const,
    translationJobId: input.translationJobId,
    vote: input.vote,
    note,
  };
}

export async function recordQualitativeRating(input: {
  translationJobId: string;
  signerId: number | null;
  naturalness: number;
  grammaticality: number;
  usefulness: number;
}) {
  for (const [name, value] of [
    ["naturalness", input.naturalness],
    ["grammaticality", input.grammaticality],
    ["usefulness", input.usefulness],
  ] as const) {
    if (!isValidLikert(value)) {
      throw new Error(`${name} must be an integer between ${LIKERT_MIN} and ${LIKERT_MAX}.`);
    }
  }

  const db = await requireDb();
  const id = crypto.randomUUID();
  const values = {
    naturalness: input.naturalness,
    grammaticality: input.grammaticality,
    usefulness: input.usefulness,
  };

  await db
    .insert(qualitativeRatings)
    .values({ id, translationJobId: input.translationJobId, signerId: input.signerId, ...values })
    .onDuplicateKeyUpdate({ set: values });

  return { id, status: "recorded" as const, ...values };
}
