import { beforeEach, describe, expect, it } from "vitest";

import { formatElapsed } from "../lib/format-elapsed";
import { clearCaptureBuffer, setCaptureBuffer, takeCaptureBuffer } from "../lib/capture-buffer";
import { makeNeutralSequence } from "./fixtures/landmark-frames";

describe("elapsed timer formatting", () => {
  it("formats sub-minute durations with a leading zero on seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_000)).toBe("0:07");
    expect(formatElapsed(59_400)).toBe("0:59");
  });

  it("rolls over into minutes", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(605_000)).toBe("10:05");
  });

  it("clamps negative input to zero", () => {
    expect(formatElapsed(-500)).toBe("0:00");
  });
});

describe("capture buffer", () => {
  beforeEach(() => clearCaptureBuffer());

  it("hands the frames to exactly one reader", () => {
    const frames = makeNeutralSequence(5);
    setCaptureBuffer(frames);
    expect(takeCaptureBuffer()).toHaveLength(5);
    // Draining twice must not replay a sequence that was already submitted.
    expect(takeCaptureBuffer()).toHaveLength(0);
  });

  it("starts empty", () => {
    expect(takeCaptureBuffer()).toEqual([]);
  });

  it("replaces rather than appends when a capture is redone", () => {
    setCaptureBuffer(makeNeutralSequence(5));
    setCaptureBuffer(makeNeutralSequence(3));
    expect(takeCaptureBuffer()).toHaveLength(3);
  });

  it("clears on demand so an abandoned capture leaves nothing behind", () => {
    setCaptureBuffer(makeNeutralSequence(5));
    clearCaptureBuffer();
    expect(takeCaptureBuffer()).toEqual([]);
  });
});
