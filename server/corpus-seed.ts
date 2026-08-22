import {
  CATEGORY_LETTERS,
  CORPUS_CATEGORIES,
  SENTENCES_PER_CATEGORY,
  type CorpusCategory,
} from "../shared/corpus";
import type { NmmType } from "../shared/workflow";

export type SeedPrompt = {
  id: string;
  category: CorpusCategory;
  orderIndex: number;
  textEnglish: string;
  expectedNmms: NmmType[];
};

/** Transcribed from Appendix A of the proposal. */
const SENTENCES: Record<CorpusCategory, string[]> = {
  declarative: [
    "I am going home.",
    "My name is [Name].",
    "The school is open.",
    "I like coffee.",
    "It is a sunny day.",
    "The bus is late.",
    "I have a pen.",
    "We are learning.",
    "The water is cold.",
    "I see a mountain.",
    "She is reading a book.",
    "He is at the market.",
    "The room is quiet.",
    "We are in Kathmandu.",
    "The teacher is busy.",
    "My brother is tall.",
    "The food is ready.",
    "I feel happy today.",
    "The sky is clear.",
    "This is my house.",
  ],
  interrogative: [
    "What is your name?",
    "Where is the hospital?",
    "Are you hungry?",
    "Can you help me?",
    "When does the shop open?",
    "How do I get to Kathmandu?",
    "Is this your bag?",
    "Who is that person?",
    "Why are you late?",
    "Do you know sign language?",
    "Where are you going?",
    "What time is it?",
    "Can I sit here?",
    "Is the bus coming?",
    "Do you live here?",
    "Are you a student?",
    "Which road should I take?",
    "When will you return?",
    "Can you repeat that?",
    "Is the water safe to drink?",
  ],
  negation: [
    "I do not understand.",
    "I don't want sugar.",
    "No, that is wrong.",
    "The doctor is not here.",
    "I cannot sign fast.",
    "There is no more rice.",
    "I didn't see the car.",
    "He is not my brother.",
    "I don't like spicy food.",
    "It is not raining.",
    "She is not at home.",
    "I do not agree.",
    "The store is not open.",
    "We cannot wait longer.",
    "There is no money left.",
    "He did not come today.",
    "This is not mine.",
    "I am not ready.",
    "They are not coming.",
    "I cannot go now.",
  ],
  temporal: [
    "I went yesterday.",
    "We will meet tomorrow.",
    "I woke up at 7 AM.",
    "Next week is a holiday.",
    "Last year I was a student.",
    "I will finish soon.",
    "Before I eat, I wash hands.",
    "After the movie, I went home.",
    "Monday is a busy day.",
    "It takes two hours.",
    "I will arrive in the evening.",
    "She came before lunch.",
    "We studied after class.",
    "The meeting starts at 9 AM.",
    "I left early this morning.",
    "The shop closes at 5 PM.",
    "I will call you later.",
    "We finished the task yesterday.",
    "He will travel next month.",
    "I eat breakfast before class.",
  ],
  utility: [
    "I need a doctor now.",
    "Where is the emergency room?",
    "I lost my wallet.",
    "Please call an interpreter.",
    "I am allergic to medicine.",
    "There is a fire.",
    "I am feeling dizzy.",
    "Please write it down.",
    "Where is the police station?",
    // Appendix A prints this as " need help with this form." — the missing
    // leading "I" is a transcription error in the source, corrected here.
    "I need help with this form.",
    "I need water.",
    "Please help me.",
    "I missed my bus.",
    "My phone is not working.",
    "Can you show me the way?",
    "I need to go to the hospital.",
    "Please speak slowly.",
    "I do not feel well.",
    "My child is sick.",
    "I need urgent assistance.",
  ],
};

/** Markers each category is designed to elicit. See design.md §6.1. */
const EXPECTED_NMMS: Record<CorpusCategory, NmmType[]> = {
  declarative: [],
  interrogative: ["eyebrow_raise"],
  negation: ["headshake"],
  temporal: ["forward_lean", "body_tilt"],
  utility: [],
};

export const corpusSeed: SeedPrompt[] = CORPUS_CATEGORIES.flatMap((category) =>
  SENTENCES[category].map((textEnglish, index) => ({
    id: `${CATEGORY_LETTERS[category]}-${String(index + 1).padStart(2, "0")}`,
    category,
    orderIndex: index,
    textEnglish,
    expectedNmms: EXPECTED_NMMS[category],
  })),
);

export type CorpusValidation = {
  valid: boolean;
  errors: string[];
  missing: { category: CorpusCategory; missing: number }[];
};

/**
 * The corpus must hold exactly twenty usable sentences per category. This guard
 * stops an edit silently shortening a category and unbalancing the study design.
 */
export function validateCorpusSeed(seed: SeedPrompt[]): CorpusValidation {
  const errors: string[] = [];
  const missing: { category: CorpusCategory; missing: number }[] = [];

  for (const category of CORPUS_CATEGORIES) {
    const usable = seed.filter((p) => p.category === category && p.textEnglish.trim().length > 0);
    const shortfall = SENTENCES_PER_CATEGORY - usable.length;
    if (shortfall > 0) {
      missing.push({ category, missing: shortfall });
      errors.push(
        `Category "${category}" holds ${usable.length} of ${SENTENCES_PER_CATEGORY} sentences; ${shortfall} missing.`,
      );
    }
  }

  const ids = seed.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push("Prompt ids are not unique.");

  return { valid: errors.length === 0, errors, missing };
}
