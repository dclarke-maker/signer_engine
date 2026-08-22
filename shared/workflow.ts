export type WorkflowStage = "capture" | "evaluation";

export type FeedbackVote = "accurate" | "needs_correction";

export type WorkflowConfig = {
  stage: WorkflowStage;
  version: string;
  updatedAt: string;
};

export type SignerCapture = {
  id: string;
  status: "recorded" | "submitted" | "failed";
  recordingUri?: string;
  createdAt: string;
};

export type EvaluationJob = {
  id: string;
  englishResponse: string;
  status: "ready" | "processing" | "complete";
};

export type FeedbackSubmission = {
  evaluationId: string;
  vote: FeedbackVote;
  note?: string;
  createdAt: string;
};

export const stageDetails: Record<
  WorkflowStage,
  { badge: string; title: string; description: string; action: string }
> = {
  capture: {
    badge: "Capture stage",
    title: "Record a clear signing sample",
    description:
      "Place your hands and upper body inside the frame. You will review the recording before sending it.",
    action: "Start a capture",
  },
  evaluation: {
    badge: "Evaluation stage",
    title: "Review an English interpretation",
    description:
      "View the response produced for a signing sample, then indicate whether it is accurate.",
    action: "Open evaluation",
  },
};
