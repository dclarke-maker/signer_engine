import type { LandmarkFrame } from "@/shared/landmarks";

/**
 * Extracted frames live here between the capture screen and the review screen.
 *
 * They must never travel as a route param: a few hundred frames of landmark
 * data would blow past any URL length, and serialising body coordinates into
 * navigation state is exactly the kind of incidental persistence the
 * privacy-first pipeline exists to avoid. This ref is process-local, dropped on
 * submit, and never written to disk.
 */
let buffer: LandmarkFrame[] = [];

export function setCaptureBuffer(frames: LandmarkFrame[]) {
  buffer = frames;
}

/** Drains the buffer. Calling twice returns an empty array by design. */
export function takeCaptureBuffer(): LandmarkFrame[] {
  const frames = buffer;
  buffer = [];
  return frames;
}

export function clearCaptureBuffer() {
  buffer = [];
}
