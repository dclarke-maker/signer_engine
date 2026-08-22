import { describe, expect, it } from "vitest";

import { corpusSeed, isCorpusTranslationValidated, validateCorpusSeed } from "../server/corpus-seed";
import { CORPUS_CATEGORIES, CORPUS_SIZE, SENTENCES_PER_CATEGORY } from "../shared/corpus";

describe("corpus seed", () => {
  it("assigns a stable, category-letter id to every prompt", () => {
    expect(corpusSeed[0].id).toBe("A-01");
    expect(new Set(corpusSeed.map((p) => p.id)).size).toBe(corpusSeed.length);
  });

  it("holds all one hundred Appendix A sentences", () => {
    expect(corpusSeed).toHaveLength(CORPUS_SIZE);
    for (const category of CORPUS_CATEGORIES) {
      expect(corpusSeed.filter((p) => p.category === category)).toHaveLength(
        SENTENCES_PER_CATEGORY,
      );
    }
  });

  it("transcribes the first and last sentence of every category", () => {
    const bounds: Record<string, [string, string]> = {
      A: ["I am going home.", "This is my house."],
      B: ["What is your name?", "Is the water safe to drink?"],
      C: ["I do not understand.", "I cannot go now."],
      D: ["I went yesterday.", "I eat breakfast before class."],
      E: ["I need a doctor now.", "I need urgent assistance."],
    };
    for (const [letter, [first, last]] of Object.entries(bounds)) {
      expect(corpusSeed.find((p) => p.id === `${letter}-01`)!.textEnglish).toBe(first);
      expect(corpusSeed.find((p) => p.id === `${letter}-20`)!.textEnglish).toBe(last);
    }
  });

  it("tags interrogatives and negations with the markers they are designed to elicit", () => {
    const question = corpusSeed.find((p) => p.id === "B-02")!;
    expect(question.textEnglish).toBe("Where is the hospital?");
    expect(question.expectedNmms).toContain("eyebrow_raise");

    const negation = corpusSeed.find((p) => p.id === "C-01")!;
    expect(negation.textEnglish).toBe("I do not understand.");
    expect(negation.expectedNmms).toContain("headshake");
  });

  it("corrects the mistyped Appendix A utility sentence", () => {
    expect(corpusSeed.some((p) => p.textEnglish === "I need help with this form.")).toBe(true);
    expect(corpusSeed.some((p) => p.textEnglish.startsWith(" need"))).toBe(false);
  });

  it("gives every prompt a Nepali rendering", () => {
    // The signer reads Nepali and signs from it. A prompt without one cannot be
    // shown at all.
    expect(corpusSeed.every((p) => p.textNepali.trim().length > 0)).toBe(true);
    expect(new Set(corpusSeed.map((p) => p.textNepali)).size).toBe(CORPUS_SIZE);
  });

  it("uses Devanagari for the Nepali, not transliterated Latin", () => {
    const devanagari = /[\u0900-\u097F]/;
    for (const p of corpusSeed) {
      expect(devanagari.test(p.textNepali), `${p.id} is not Devanagari`).toBe(true);
    }
  });

  it("keeps question marks on interrogatives in both languages", () => {
    for (const p of corpusSeed.filter((x) => x.category === "interrogative")) {
      expect(p.textEnglish.endsWith("?"), `${p.id} English`).toBe(true);
      expect(p.textNepali.endsWith("?"), `${p.id} Nepali`).toBe(true);
    }
  });

  it("reports the corpus as unvalidated until a native reviewer signs it off", () => {
    // Every rendering is currently a draft. Collection must not proceed on
    // drafts: the signer reads the Nepali while the model is scored against the
    // English, so a loose translation mislabels every sample taken against it.
    expect(corpusSeed.every((p) => p.nepaliSource === "machine-draft")).toBe(true);
    expect(isCorpusTranslationValidated()).toBe(false);
  });

  it("recognises a fully validated corpus", () => {
    const validated = corpusSeed.map((p) => ({ ...p, nepaliSource: "ndfn-validated" as const }));
    expect(isCorpusTranslationValidated(validated)).toBe(true);
  });

  it("has no blank or duplicate sentences", () => {
    expect(corpusSeed.every((p) => p.textEnglish.trim().length > 0)).toBe(true);
    expect(new Set(corpusSeed.map((p) => p.textEnglish)).size).toBe(CORPUS_SIZE);
  });

  it("passes validation", () => {
    const result = validateCorpusSeed(corpusSeed);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("fails validation when a category is short", () => {
    const short = corpusSeed.filter((p) => p.id !== "E-20");
    const result = validateCorpusSeed(short);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([{ category: "utility", missing: 1 }]);
    expect(result.errors[0]).toContain("utility");
  });
});
