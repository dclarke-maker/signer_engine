import type { LandmarkExtractor } from "@/shared/landmarks";

/**
 * True when a camera must deliver frames to this extractor.
 *
 * Pull extractors (fixture, web) run their own loop and only need a subscriber.
 * Push extractors are fed by a frame processor. Getting this wrong produces no
 * error - just an extractor that never emits - so the camera checks rather than
 * assuming.
 */
export function needsPushedFrames(
  extractor: LandmarkExtractor,
): extractor is LandmarkExtractor & { acceptBuffer(buffer: ArrayBuffer): void } {
  return typeof extractor.acceptBuffer === "function";
}
