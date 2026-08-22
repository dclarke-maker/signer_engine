import { describe, expect, it } from "vitest";

import { createFixtureExtractor } from "../lib/extractors/fixture-extractor";
import { makeSequence } from "./fixtures/landmark-frames";

describe("fixture landmark extractor", () => {
  it("replays every frame to a subscriber", async () => {
    const frames = makeSequence({ frameCount: 5 });
    const extractor = createFixtureExtractor(frames);
    const seen: number[] = [];

    await extractor.start({ targetFps: 30 });
    extractor.subscribe((frame) => seen.push(frame.t));
    await extractor.stop();

    expect(seen).toEqual(frames.map((f) => f.t));
  });

  it("summarizes duration and achieved frame rate", async () => {
    const extractor = createFixtureExtractor(makeSequence({ frameCount: 30, fps: 30 }));
    await extractor.start({ targetFps: 30 });
    extractor.subscribe(() => {});
    const summary = await extractor.stop();

    expect(summary.frameCount).toBe(30);
    expect(summary.durationMs).toBe(967);
    expect(summary.achievedFps).toBeCloseTo(31.0, 0);
  });

  it("reports per-stream coverage so missing streams stay visible", async () => {
    const frames = makeSequence({
      frameCount: 4,
      mutate: (frame, i) => (i < 2 ? { ...frame, leftHand: null } : frame),
    });
    const extractor = createFixtureExtractor(frames);
    await extractor.start({ targetFps: 30 });
    extractor.subscribe(() => {});
    const summary = await extractor.stop();

    expect(summary.coverage.leftHand).toBe(0.5);
    expect(summary.coverage.face).toBe(1);
  });

  it("stops delivering frames after unsubscribe", async () => {
    const extractor = createFixtureExtractor(makeSequence({ frameCount: 3 }));
    let count = 0;
    await extractor.start({ targetFps: 30 });
    const unsubscribe = extractor.subscribe(() => {
      count += 1;
      if (count === 1) unsubscribe();
    });
    await extractor.stop();

    expect(count).toBe(1);
  });
});
