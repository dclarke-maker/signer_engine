import type {
  LandmarkExtractor,
  LandmarkFrame,
  LandmarkSequenceSummary,
} from "@/shared/landmarks";

/**
 * Replays a fixed frame list. This is the CI implementation of `LandmarkExtractor`
 * and the reason the capture, tagging, and API layers are testable without a
 * native build or a camera.
 */
export function createFixtureExtractor(frames: LandmarkFrame[]): LandmarkExtractor {
  let listener: ((frame: LandmarkFrame) => void) | null = null;
  let started = false;

  return {
    id: "fixture@1",

    async start() {
      started = true;
    },

    subscribe(onFrame) {
      listener = onFrame;
      return () => {
        listener = null;
      };
    },

    async stop(): Promise<LandmarkSequenceSummary> {
      if (!started) throw new Error("The extractor was stopped before it was started.");
      for (const frame of frames) listener?.(frame);
      started = false;
      listener = null;
      return summarize(frames);
    },
  };
}

function summarize(frames: LandmarkFrame[]): LandmarkSequenceSummary {
  const frameCount = frames.length;
  const durationMs = frameCount === 0 ? 0 : frames[frameCount - 1].t - frames[0].t;
  const achievedFps = durationMs === 0 ? 0 : (frameCount / durationMs) * 1000;
  const ratio = (predicate: (frame: LandmarkFrame) => boolean) =>
    frameCount === 0 ? 0 : frames.filter(predicate).length / frameCount;

  return {
    frameCount,
    durationMs,
    achievedFps,
    coverage: {
      leftHand: ratio((f) => f.leftHand !== null),
      rightHand: ratio((f) => f.rightHand !== null),
      face: ratio((f) => f.face !== null),
      pose: ratio((f) => f.pose !== null),
    },
    // A fixture replays frames that are already decoded; there is nothing to
    // fail at.
    decodeFailures: 0,
  };
}
