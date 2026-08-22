import { describe, expect, it } from "vitest";

import {
  CORPUS_CATEGORIES,
  CORPUS_SIZE,
  SENTENCES_PER_CATEGORY,
} from "../shared/corpus";
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
} from "../shared/landmarks";
import {
  feedbackVoteValues,
  sessionStatuses,
  stageDetails,
  translationStatuses,
  workflowStages,
} from "../shared/workflow";

describe("landmark stream sizes", () => {
  it("matches the proposal's stream counts exactly", () => {
    expect(HAND_LANDMARK_COUNT).toBe(21);
    expect(FACE_LANDMARK_COUNT).toBe(468);
    expect(POSE_LANDMARK_COUNT).toBe(33);
  });
});

describe("corpus vocabulary", () => {
  it("defines five categories of twenty sentences", () => {
    expect(CORPUS_CATEGORIES).toEqual([
      "declarative",
      "interrogative",
      "negation",
      "temporal",
      "utility",
    ]);
    expect(SENTENCES_PER_CATEGORY).toBe(20);
    expect(CORPUS_SIZE).toBe(CORPUS_CATEGORIES.length * SENTENCES_PER_CATEGORY);
    expect(CORPUS_SIZE).toBe(100);
  });
});

describe("workflow vocabulary", () => {
  it("names the two research phases", () => {
    expect(workflowStages).toEqual(["capture", "translation"]);
  });

  it("describes every stage for the workspace screen", () => {
    for (const stage of workflowStages) {
      expect(stageDetails[stage].action.length).toBeGreaterThan(0);
    }
  });

  it("defines session, translation, and vote vocabularies", () => {
    expect(sessionStatuses).toEqual([
      "recording",
      "pending_upload",
      "stored",
      "superseded",
      "skipped",
      "failed",
    ]);
    expect(translationStatuses).toEqual(["pending", "processing", "complete", "failed"]);
    expect(feedbackVoteValues).toEqual(["accurate", "needs_correction"]);
  });
});
