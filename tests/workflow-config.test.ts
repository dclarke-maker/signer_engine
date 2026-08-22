import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { defaultWorkflowStage, resolveWorkflowStage } from "../server/workflow-config";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("workflow stage resolution", () => {
  it("uses capture as the safe initial stage", () => {
    expect(resolveWorkflowStage(undefined)).toBe(defaultWorkflowStage);
    expect(resolveWorkflowStage("unknown-stage")).toBe("capture");
  });

  it("enables the evaluation stage only when the API configuration selects it", () => {
    expect(resolveWorkflowStage("evaluation")).toBe("evaluation");
  });

  it("accepts a directional feedback vote with an optional correction note", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.feedback.submit({
      evaluationId: "fixture-01",
      vote: "needs_correction",
      note: "The response omits the final phrase.",
      createdAt: "2026-08-21T06:41:00.000Z",
    });

    expect(result).toMatchObject({
      status: "accepted",
      evaluationId: "fixture-01",
      vote: "needs_correction",
      note: "The response omits the final phrase.",
    });
    expect(result.id).toEqual(expect.any(String));
  });
});
