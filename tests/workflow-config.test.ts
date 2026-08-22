import { describe, expect, it } from "vitest";

import { defaultWorkflowStage, resolveWorkflowStage } from "../server/workflow-config";

describe("workflow stage resolution", () => {
  it("uses capture as the safe initial stage", () => {
    expect(resolveWorkflowStage(undefined)).toBe(defaultWorkflowStage);
    expect(resolveWorkflowStage("unknown-stage")).toBe("capture");
  });

  it("enables the translation stage only when the API configuration selects it", () => {
    expect(resolveWorkflowStage("translation")).toBe("translation");
  });

  it("does not honour the retired evaluation stage name", () => {
    expect(resolveWorkflowStage("evaluation")).toBe("capture");
  });
});
