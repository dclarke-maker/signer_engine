import { describe, expect, it } from "vitest";

import { createFixtureExtractor } from "../lib/extractors/fixture-extractor";
import { needsPushedFrames } from "../lib/extractors/shape";
import { makeNeutralSequence } from "./fixtures/landmark-frames";
import type { LandmarkExtractor } from "../shared/landmarks";

const summary = async () => ({
  frameCount: 0,
  durationMs: 0,
  achievedFps: 0,
  coverage: { leftHand: 0, rightHand: 0, face: 0, pose: 0 },
});

/**
 * The native extractor is not imported here: it pulls in
 * react-native-vision-camera, which vitest cannot parse. That is precisely why
 * its decodable core lives in holistic-buffer.ts, which is tested directly.
 * This suite covers the discrimination the camera depends on.
 */
describe("extractor shape", () => {
  it("recognises a pull extractor, which drives itself", () => {
    expect(needsPushedFrames(createFixtureExtractor(makeNeutralSequence(3)))).toBe(false);
  });

  it("recognises a push extractor, which a frame processor must feed", () => {
    // Rendering a camera that never calls acceptBuffer would leave this
    // producing nothing at all, with no error - the failure this guard exists
    // to prevent.
    const push: LandmarkExtractor = {
      id: "push@1",
      start: async () => {},
      subscribe: () => () => {},
      stop: summary,
      acceptBuffer: () => {},
    };
    expect(needsPushedFrames(push)).toBe(true);
  });

  it("treats an extractor without acceptBuffer as pull", () => {
    const pull: LandmarkExtractor = {
      id: "pull@1",
      start: async () => {},
      subscribe: () => () => {},
      stop: summary,
    };
    expect(needsPushedFrames(pull)).toBe(false);
  });

  it("narrows the type so a caller can invoke acceptBuffer safely", () => {
    let received = 0;
    const push: LandmarkExtractor = {
      id: "push@1",
      start: async () => {},
      subscribe: () => () => {},
      stop: summary,
      acceptBuffer: () => {
        received += 1;
      },
    };
    if (needsPushedFrames(push)) push.acceptBuffer(new ArrayBuffer(0));
    expect(received).toBe(1);
  });
});
