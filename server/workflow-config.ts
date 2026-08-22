import type { WorkflowStage } from "../shared/workflow";

export const defaultWorkflowStage: WorkflowStage = "capture";

export function resolveWorkflowStage(value: string | undefined): WorkflowStage {
  return value === "evaluation" ? "evaluation" : defaultWorkflowStage;
}

export function getWorkflowConfig() {
  return {
    stage: resolveWorkflowStage(process.env.WORKFLOW_STAGE),
    version: process.env.WORKFLOW_CONFIG_VERSION ?? "local-v1",
    updatedAt: new Date().toISOString(),
  };
}
