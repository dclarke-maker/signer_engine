export const CORPUS_CATEGORIES = [
  "declarative",
  "interrogative",
  "negation",
  "temporal",
  "utility",
] as const;

export type CorpusCategory = (typeof CORPUS_CATEGORIES)[number];

export const SENTENCES_PER_CATEGORY = 20;
export const CORPUS_SIZE = CORPUS_CATEGORIES.length * SENTENCES_PER_CATEGORY;

/** Appendix A category letters, used for prompt ids such as `B-02`. */
export const CATEGORY_LETTERS: Record<CorpusCategory, string> = {
  declarative: "A",
  interrogative: "B",
  negation: "C",
  temporal: "D",
  utility: "E",
};

export const CATEGORY_PURPOSE: Record<CorpusCategory, string> = {
  declarative: "Baseline sentence structure and lexical order",
  interrogative: "Question force and eyebrow raise",
  negation: "Head shake and negative marking",
  temporal: "Time reference and motion context",
  utility: "Everyday functional communication",
};
