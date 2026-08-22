import { createFixtureExtractor } from "./fixture-extractor";
import { demoSequence } from "./demo-sequence";
import type { LandmarkExtractor } from "@/shared/landmarks";

/**
 * The screens depend on this, never on a concrete extractor. Swapping in the
 * native MediaPipe Tasks extractor is a one-line change here; no screen moves.
 */
export function getExtractor(): LandmarkExtractor {
  return createFixtureExtractor(demoSequence);
}

export const TARGET_FPS = 30;
