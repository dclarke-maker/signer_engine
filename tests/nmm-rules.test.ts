import { describe, expect, it } from "vitest";

import { computeSignerBaseline } from "../server/nmm/baseline";
import { confidenceFor, detectNmms, nmmRules } from "../server/nmm/rules";
import { BASELINE_RULE_VERSION } from "../server/nmm/thresholds";
import { makePoseFrame, makeSequence } from "./fixtures/landmark-frames";
import type { LandmarkFrame } from "../shared/landmarks";

const poseFrame = makePoseFrame;

const neutral = (count: number) => Array.from({ length: count }, (_, i) => poseFrame(i * 33));

describe("signer baseline", () => {
  it("derives shoulder width and neutral head position from opening frames", () => {
    const baseline = computeSignerBaseline(neutral(30));
    expect(baseline).not.toBeNull();
    expect(baseline!.shoulderWidth).toBeCloseTo(0.2, 3);
    expect(baseline!.neutralBrowGap).toBeGreaterThan(0);
  });

  it("returns null when pose is never detected", () => {
    const frames = makeSequence({ frameCount: 10, mutate: (f) => ({ ...f, pose: null }) });
    expect(computeSignerBaseline(frames)).toBeNull();
  });
});

describe("confidence scaling", () => {
  it("floors at the threshold and rises monotonically without saturating", () => {
    expect(confidenceFor(1)).toBe(0.5);
    expect(confidenceFor(0.4)).toBe(0.5);
    const at2 = confidenceFor(2);
    const at4 = confidenceFor(4);
    const at12 = confidenceFor(12);
    expect(at2).toBeGreaterThan(0.5);
    expect(at4).toBeGreaterThan(at2);
    expect(at12).toBeGreaterThan(at4);
    expect(at12).toBeLessThan(1);
  });

  it("keeps a marginal marker distinguishable from an emphatic one", () => {
    expect(confidenceFor(4) - confidenceFor(1.2)).toBeGreaterThan(0.1);
  });
});

describe("the five detection rules", () => {
  it("registers exactly the five proposal rules", () => {
    expect(nmmRules.map((r) => r.type)).toEqual([
      "eyebrow_raise",
      "headshake",
      "shoulder_shrug",
      "forward_lean",
      "body_tilt",
    ]);
    expect(nmmRules.every((r) => r.ruleVersion === BASELINE_RULE_VERSION)).toBe(true);
  });

  it("finds nothing in a neutral sequence", () => {
    const detections = detectNmms(neutral(60), { baseline: computeSignerBaseline(neutral(30))! });
    expect(detections).toEqual([]);
  });

  it("detects an eyebrow raise when brows lift away from the eyes", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(15),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(500 + i * 33, { browL: [0.45, 0.24, 0], browR: [0.55, 0.24, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "eyebrow_raise");
    expect(hit).toBeDefined();
    expect(hit!.startFrame).toBeGreaterThanOrEqual(15);
    expect(hit!.confidence).toBeGreaterThan(0);
    expect(hit!.confidence).toBeLessThanOrEqual(1);
  });

  it("detects a headshake from horizontal nose oscillation", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 36 }, (_, i) =>
        poseFrame(330 + i * 33, { nose: [0.5 + (i % 6 < 3 ? 0.05 : -0.05), 0.35, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "headshake");
    expect(hit).toBeDefined();
  });

  it("detects a shoulder shrug when the shoulder-to-ear gap compresses", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { shoulderL: [0.4, 0.4, 0], shoulderR: [0.6, 0.4, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "shoulder_shrug");
    expect(hit).toBeDefined();
  });

  it("detects a forward lean from shoulder-to-hip depth delta", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { shoulderL: [0.4, 0.5, -0.15], shoulderR: [0.6, 0.5, -0.15] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "forward_lean");
    expect(hit).toBeDefined();
  });

  it("detects a body tilt from shoulder-line angle", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { shoulderL: [0.4, 0.44, 0], shoulderR: [0.6, 0.56, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "body_tilt");
    expect(hit).toBeDefined();
  });

  it("stamps every detection with the rule version that produced it", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { browL: [0.45, 0.24, 0], browR: [0.55, 0.24, 0] }),
      ),
    ];
    for (const d of detectNmms(frames, { baseline: base })) {
      expect(d.ruleVersion).toBe(BASELINE_RULE_VERSION);
    }
  });
});
