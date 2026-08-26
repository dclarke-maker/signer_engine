import {
  CATEGORY_LETTERS,
  CORPUS_CATEGORIES,
  SENTENCES_PER_CATEGORY,
  type CorpusCategory,
} from "../shared/corpus";
import type { NmmType } from "../shared/workflow";

/**
 * How a Nepali rendering came to be. Recorded per prompt because the signer
 * reads the Nepali and signs from it, while the model is scored against the
 * English - so a loose translation silently mislabels every sample taken
 * against it. Nothing may be collected on an unvalidated prompt.
 */
export type NepaliSource = "ndfn-validated" | "machine-draft";

export type SeedPrompt = {
  id: string;
  category: CorpusCategory;
  orderIndex: number;
  textEnglish: string;
  /** Shown to the signer. Nepali literacy is the realistic reading path here. */
  textNepali: string;
  nepaliSource: NepaliSource;
  expectedNmms: NmmType[];
};

/** Transcribed from Appendix A of the proposal. */
/** [english, nepali] - Nepali drafted in-project, pending NDFN review. */
const SENTENCES: Record<CorpusCategory, [string, string][]> = {
  declarative: [
    ["I am going home.", "म घर जाँदैछु।"],
    // Appendix A prints this with a "[Name]" placeholder. A signer cannot
    // render brackets, and the three things they might do instead all break
    // something: fingerspelling their own name makes every sample for this
    // prompt different content against one reference, fingerspelling the word
    // "Name" is not what anyone would do unprompted, and skipping it leaves a
    // dangling structure. It is also the one prompt where signers would not
    // agree with each other, which is what the corpus depends on. Instantiated
    // with a fixed common name so every signer renders the same sentence.
    ["My name is Sita.", "मेरो नाम सीता हो।"],
    ["The school is open.", "विद्यालय खुला छ।"],
    ["I like coffee.", "मलाई कफी मन पर्छ।"],
    ["It is a sunny day.", "आज घमाइलो दिन छ।"],
    ["The bus is late.", "बस ढिलो भयो।"],
    ["I have a pen.", "मसँग कलम छ।"],
    ["We are learning.", "हामी सिक्दैछौं।"],
    ["The water is cold.", "पानी चिसो छ।"],
    ["I see a mountain.", "म हिमाल देख्छु।"],
    ["She is reading a book.", "उनी किताब पढ्दैछिन्।"],
    ["He is at the market.", "उनी बजारमा छन्।"],
    ["The room is quiet.", "कोठा शान्त छ।"],
    ["We are in Kathmandu.", "हामी काठमाडौंमा छौं।"],
    ["The teacher is busy.", "शिक्षक व्यस्त हुनुहुन्छ।"],
    ["My brother is tall.", "मेरो दाइ अग्लो छन्।"],
    ["The food is ready.", "खाना तयार छ।"],
    ["I feel happy today.", "आज म खुसी छु।"],
    ["The sky is clear.", "आकाश सफा छ।"],
    ["This is my house.", "यो मेरो घर हो।"],
  ],
  interrogative: [
    ["What is your name?", "तपाईंको नाम के हो?"],
    ["Where is the hospital?", "अस्पताल कहाँ छ?"],
    ["Are you hungry?", "तपाईंलाई भोक लाग्यो?"],
    ["Can you help me?", "के तपाईं मलाई सहयोग गर्न सक्नुहुन्छ?"],
    ["When does the shop open?", "पसल कहिले खुल्छ?"],
    ["How do I get to Kathmandu?", "काठमाडौं कसरी पुग्ने?"],
    ["Is this your bag?", "के यो तपाईंको झोला हो?"],
    ["Who is that person?", "त्यो व्यक्ति को हो?"],
    ["Why are you late?", "तपाईं किन ढिलो हुनुभयो?"],
    ["Do you know sign language?", "के तपाईंलाई सांकेतिक भाषा आउँछ?"],
    ["Where are you going?", "तपाईं कहाँ जाँदै हुनुहुन्छ?"],
    ["What time is it?", "अहिले कति बज्यो?"],
    ["Can I sit here?", "के म यहाँ बस्न सक्छु?"],
    ["Is the bus coming?", "बस आउँदैछ?"],
    ["Do you live here?", "के तपाईं यहाँ बस्नुहुन्छ?"],
    ["Are you a student?", "के तपाईं विद्यार्थी हुनुहुन्छ?"],
    ["Which road should I take?", "मैले कुन बाटो जानुपर्छ?"],
    ["When will you return?", "तपाईं कहिले फर्कनुहुन्छ?"],
    ["Can you repeat that?", "के तपाईं फेरि भन्न सक्नुहुन्छ?"],
    ["Is the water safe to drink?", "के यो पानी पिउन सुरक्षित छ?"],
  ],
  negation: [
    ["I do not understand.", "म बुझ्दिनँ।"],
    ["I don't want sugar.", "मलाई चिनी चाहिँदैन।"],
    ["No, that is wrong.", "होइन, त्यो गलत हो।"],
    ["The doctor is not here.", "डाक्टर यहाँ हुनुहुन्न।"],
    ["I cannot sign fast.", "म छिटो सङ्केत गर्न सक्दिनँ।"],
    ["There is no more rice.", "अब भात छैन।"],
    ["I didn't see the car.", "मैले गाडी देखिनँ।"],
    ["He is not my brother.", "उनी मेरो दाइ होइनन्।"],
    ["I don't like spicy food.", "मलाई पिरो खाना मन पर्दैन।"],
    ["It is not raining.", "पानी परिरहेको छैन।"],
    ["She is not at home.", "उनी घरमा छैनन्।"],
    ["I do not agree.", "म सहमत छैनँ।"],
    ["The store is not open.", "पसल खुलेको छैन।"],
    ["We cannot wait longer.", "हामी अझै पर्खन सक्दैनौं।"],
    ["There is no money left.", "पैसा बाँकी छैन।"],
    ["He did not come today.", "उनी आज आएनन्।"],
    ["This is not mine.", "यो मेरो होइन।"],
    ["I am not ready.", "म तयार छैनँ।"],
    ["They are not coming.", "तिनीहरू आउँदैनन्।"],
    ["I cannot go now.", "म अहिले जान सक्दिनँ।"],
  ],
  temporal: [
    ["I went yesterday.", "म हिजो गएँ।"],
    ["We will meet tomorrow.", "हामी भोलि भेट्नेछौं।"],
    ["I woke up at 7 AM.", "म बिहान सात बजे उठें।"],
    ["Next week is a holiday.", "अर्को हप्ता बिदा छ।"],
    ["Last year I was a student.", "गत वर्ष म विद्यार्थी थिएँ।"],
    ["I will finish soon.", "म चाँडै सक्नेछु।"],
    ["Before I eat, I wash hands.", "खानुअघि म हात धुन्छु।"],
    ["After the movie, I went home.", "फिल्मपछि म घर गएँ।"],
    ["Monday is a busy day.", "सोमबार व्यस्त दिन हो।"],
    ["It takes two hours.", "दुई घण्टा लाग्छ।"],
    ["I will arrive in the evening.", "म बेलुका आइपुग्नेछु।"],
    ["She came before lunch.", "उनी खाजाअघि आइन्।"],
    ["We studied after class.", "हामीले कक्षापछि पढ्यौं।"],
    ["The meeting starts at 9 AM.", "बैठक बिहान नौ बजे सुरु हुन्छ।"],
    ["I left early this morning.", "म आज बिहान सबेरै हिँडें।"],
    ["The shop closes at 5 PM.", "पसल बेलुका पाँच बजे बन्द हुन्छ।"],
    ["I will call you later.", "म तपाईंलाई पछि फोन गर्नेछु।"],
    ["We finished the task yesterday.", "हामीले हिजो काम सक्यौं।"],
    ["He will travel next month.", "उनी अर्को महिना यात्रा गर्नेछन्।"],
    ["I eat breakfast before class.", "म कक्षाअघि बिहानको खाना खान्छु।"],
  ],
  utility: [
    ["I need a doctor now.", "मलाई अहिले डाक्टर चाहियो।"],
    ["Where is the emergency room?", "आपतकालीन कक्ष कहाँ छ?"],
    ["I lost my wallet.", "मेरो पर्स हरायो।"],
    ["Please call an interpreter.", "कृपया दोभाषे बोलाउनुहोस्।"],
    ["I am allergic to medicine.", "मलाई औषधिको एलर्जी छ।"],
    ["There is a fire.", "आगलागी भयो।"],
    ["I am feeling dizzy.", "मलाई रिंगटा लागिरहेको छ।"],
    ["Please write it down.", "कृपया लेखिदिनुस्।"],
    ["Where is the police station?", "प्रहरी चौकी कहाँ छ?"],
    // Appendix A prints this as " need help with this form." — the missing
    // leading "I" is a transcription error in the source, corrected here.
    ["I need help with this form.", "मलाई यो फारम भर्न सहयोग चाहियो।"],
    ["I need water.", "मलाई पानी चाहियो।"],
    ["Please help me.", "कृपया मलाई सहयोग गर्नुहोस्।"],
    ["I missed my bus.", "मेरो बस छुट्यो।"],
    ["My phone is not working.", "मेरो फोन चलिरहेको छैन।"],
    ["Can you show me the way?", "के तपाईं मलाई बाटो देखाउन सक्नुहुन्छ?"],
    ["I need to go to the hospital.", "मलाई अस्पताल जानुछ।"],
    ["Please speak slowly.", "कृपया बिस्तारै बोल्नुस्।"],
    ["I do not feel well.", "मलाई सन्चो छैन।"],
    ["My child is sick.", "मेरो बच्चा बिरामी छ।"],
    ["I need urgent assistance.", "मलाई तत्काल सहयोग चाहियो।"],
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

/**
 * Nepali renderings carried over from the earlier nsl-translator corpus, where
 * an identical English sentence already had one. Those nine are the only
 * translations this project did not draft itself.
 */
const CARRIED_OVER = new Set<string>([
  "This is my house.",
  "What is your name?",
  "Can you help me?",
  "What time is it?",
  "Can I sit here?",
  "Can you repeat that?",
  "I do not understand.",
  "Please write it down.",
  "Please speak slowly.",
]);

export const corpusSeed: SeedPrompt[] = CORPUS_CATEGORIES.flatMap((category) =>
  SENTENCES[category].map(([textEnglish, textNepali], index) => ({
    id: `${CATEGORY_LETTERS[category]}-${String(index + 1).padStart(2, "0")}`,
    category,
    orderIndex: index,
    textEnglish,
    textNepali,
    // Every rendering is a draft until NDFN reviews it, including the carried
    // over ones - they came from a corpus of unknown provenance.
    nepaliSource: "machine-draft" as NepaliSource,
    expectedNmms: EXPECTED_NMMS[category],
  })),
);

/** True when every prompt has a Nepali rendering a native reviewer has signed off. */
export function isCorpusTranslationValidated(seed: SeedPrompt[] = corpusSeed): boolean {
  return seed.every((p) => p.nepaliSource === "ndfn-validated");
}

export { CARRIED_OVER as NEPALI_CARRIED_OVER_FROM_EARLIER_CORPUS };

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
