import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import {
  FIXTURE_MODEL_VERSION,
  createFixtureTranslator,
  getTranslator,
} from "../server/translation-service";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("fixture translator", () => {
  it("reports a model version so results stay attributable", () => {
    expect(createFixtureTranslator().modelVersion).toBe(FIXTURE_MODEL_VERSION);
  });

  it("is deterministic for the same sequence reference", async () => {
    const translator = createFixtureTranslator();
    const a = await translator.translate({ sequenceRef: "s-1", frameCount: 120 });
    const b = await translator.translate({ sequenceRef: "s-1", frameCount: 120 });
    expect(a).toEqual(b);
  });

  it("varies its output across different sequences", async () => {
    const translator = createFixtureTranslator();
    const outputs = await Promise.all(
      ["s-1", "s-2", "s-3", "s-4", "s-5", "s-6"].map((ref) =>
        translator.translate({ sequenceRef: ref, frameCount: 120 }),
      ),
    );
    expect(new Set(outputs.map((o) => o.englishResponse)).size).toBeGreaterThan(1);
  });

  it("returns a confidence inside the unit interval", async () => {
    const { confidence } = await createFixtureTranslator().translate({
      sequenceRef: "s-9",
      frameCount: 200,
    });
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("never claims certainty, so the UI cannot present output as definitive", async () => {
    const translator = createFixtureTranslator();
    for (const frameCount of [1, 100, 450, 5000]) {
      const { confidence } = await translator.translate({ sequenceRef: "s-x", frameCount });
      expect(confidence).toBeLessThan(1);
    }
  });

  it("selects the fixture translator when no model is configured", () => {
    delete process.env.SIGN_TRANSLATOR_MODE;
    expect(getTranslator().modelVersion).toBe(FIXTURE_MODEL_VERSION);
  });
});

describe("translation router authorization", () => {
  it("refuses to request a translation without a signer", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.translation.request({ sessionId: "s-1", frameCount: 120 }),
    ).rejects.toThrow(/sign in/i);
  });

  it("rejects a non-positive frame count", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.translation.request({ sessionId: "s-1", frameCount: 0 }),
    ).rejects.toThrow();
  });
});
