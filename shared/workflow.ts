export const workflowStages = ["capture", "translation"] as const;
export type WorkflowStage = (typeof workflowStages)[number];

export const sessionStatuses = [
  "recording",
  "pending_upload",
  "stored",
  "superseded",
  "skipped",
  "failed",
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const translationStatuses = ["pending", "processing", "complete", "failed"] as const;
export type TranslationStatus = (typeof translationStatuses)[number];

export const feedbackVoteValues = ["accurate", "needs_correction"] as const;
export type FeedbackVote = (typeof feedbackVoteValues)[number];

export const nmmTypes = [
  "eyebrow_raise",
  "headshake",
  "shoulder_shrug",
  "forward_lean",
  "body_tilt",
] as const;
export type NmmType = (typeof nmmTypes)[number];

export type WorkflowConfig = {
  stage: WorkflowStage;
  version: string;
  updatedAt: string;
};

export const stageDetails: Record<
  WorkflowStage,
  { badge: string; title: string; description: string; action: string }
> = {
  capture: {
    badge: "Collection phase",
    title: "Sign a prompted sentence",
    description:
      "You will see a sentence to sign. Your camera stays on this device - only anonymous motion points are sent, never video.",
    action: "Continue collecting",
  },
  translation: {
    badge: "Translation phase",
    title: "Sign and review the English",
    description:
      "Sign into the camera and review the English the model produces, then tell us how accurate it was.",
    action: "Start translating",
  },
};
