import { describe, expect, it } from "vitest";

import { createFramingGate, isInFrame } from "../lib/capture/framing";
import {
  createRestDetector,
  handSpeed,
  proposeTrim,
} from "../shared/rest-trim";
import {
  BLOCK_SIZE,
  RECORDING_WINDOW_MS,
  REST_HOLD_MS,
} from "../shared/capture-session";
import { CORPUS_CATEGORIES, CORPUS_SIZE } from "../shared/corpus";
import { makeFrame, makeLandmarks } from "./fixtures/landmark-frames";
import { HAND_LANDMARK_COUNT, type LandmarkFrame } from "../shared/landmarks";

/** A hand translated by (dx, dy) from a fixed starting layout. */
function handAt(dx: number, dy: number) {
  return makeLandmarks(HAND_LANDMARK_COUNT, 1).map((p) => ({
    ...p,
    x: 0.5 + dx,
    y: 0.5 + dy,
  }));
}

function frameAt(
  t: number,
  dx: number,
  dy = 0,
  aspect?: number,
): LandmarkFrame {
  return makeFrame({
    t,
    leftHand: handAt(dx, dy),
    rightHand: handAt(dx, dy),
    aspect,
  });
}

/** Feeds a run of frames and returns the verdict on the last one. */
function run(
  detector: ReturnType<typeof createRestDetector>,
  frames: LandmarkFrame[],
) {
  let last = detector.accept(frames[0]);
  for (const frame of frames.slice(1)) last = detector.accept(frame);
  return last;
}

/** `count` frames at 30fps, each moved `perFrame` further along x. */
function moving(
  from: number,
  count: number,
  perFrame: number,
): LandmarkFrame[] {
  return Array.from({ length: count }, (_, i) =>
    frameAt(Math.round(from + i * (1000 / 30)), i * perFrame),
  );
}

describe("hand speed", () => {
  it("is zero for a hand that did not move", () => {
    expect(handSpeed(frameAt(0, 0), frameAt(100, 0), 1)).toBe(0);
  });

  it("reports frame-heights per second", () => {
    // 0.1 of the frame in 100ms is 1.0 per second.
    expect(handSpeed(frameAt(0, 0), frameAt(100, 0.1), 1)).toBeCloseTo(1, 5);
  });

  it("corrects horizontal movement for a non-square frame", () => {
    // On a 9:16 portrait frame a unit of x is 0.5625 of a unit of y, so raw dx
    // under-reads lateral signing by nearly half. Signing is mostly lateral, so
    // without this a moving signer reads as still.
    const wide = handSpeed(
      frameAt(0, 0, 0, 9 / 16),
      frameAt(100, 0.1, 0, 9 / 16),
      9 / 16,
    );
    expect(wide).toBeCloseTo(0.5625, 4);
  });

  it("cannot measure a hand that is absent from either frame", () => {
    const gone = makeFrame({ t: 100, leftHand: null, rightHand: null });
    expect(handSpeed(frameAt(0, 0), gone, 1)).toBeNull();
  });

  it("refuses to divide by a non-advancing clock", () => {
    expect(handSpeed(frameAt(50, 0), frameAt(50, 0.1), 1)).toBeNull();
  });
});

describe("rest detector", () => {
  it("does not stop a signer who has not started yet", () => {
    // The state right after the countdown: in frame, hands down, perfectly
    // still. Indistinguishable from having finished, except that nothing has
    // been signed. Stopping here would truncate every sentence to nothing.
    const detector = createRestDetector();
    const stillFrames = Array.from({ length: 200 }, (_, i) =>
      frameAt(Math.round(i * (1000 / 30)), 0),
    );
    const verdict = run(detector, stillFrames);

    expect(verdict.armed).toBe(false);
    expect(verdict.stop).toBe(false);
  });

  it("stops once a signer who has signed comes to rest", () => {
    const detector = createRestDetector();
    const signing = moving(0, 90, 0.02); // 3s of movement
    const after = Array.from({ length: 90 }, (_, i) =>
      frameAt(3000 + Math.round(i * (1000 / 30)), 90 * 0.02),
    );
    const verdict = run(detector, [...signing, ...after]);

    expect(verdict.armed).toBe(true);
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe("rest");
  });

  it("treats hands leaving the frame as rest", () => {
    // How a signer actually finishes: hands drop to their sides, out of shot.
    const detector = createRestDetector();
    const signing = moving(0, 90, 0.02);
    const dropped = Array.from({ length: 90 }, (_, i) =>
      makeFrame({
        t: 3000 + Math.round(i * (1000 / 30)),
        leftHand: null,
        rightHand: null,
      }),
    );
    const verdict = run(detector, [...signing, ...dropped]);

    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe("rest");
  });

  it("does not cut a sentence at a held handshape", () => {
    // A hold mid-sentence is stillness that carries meaning. Stopping on it
    // amputates the rest of the utterance, which no later stage can recover.
    const detector = createRestDetector({ restHoldMs: 1500 });
    const signing = moving(0, 60, 0.02); // 2s moving
    const held = Array.from({ length: 30 }, (_, i) =>
      frameAt(2000 + Math.round(i * (1000 / 30)), 60 * 0.02),
    ); // 1s held - under the hold window

    const verdict = run(detector, [...signing, ...held]);
    expect(verdict.stop).toBe(false);
    expect(verdict.restingMs).toBeLessThan(1500);
  });

  it("never stops before the minimum, however still the signer is", () => {
    const detector = createRestDetector({
      minRecordingMs: 2000,
      restHoldMs: 100,
    });
    const twitch = moving(0, 4, 0.05); // brief movement, arms the detector
    const still = Array.from({ length: 20 }, (_, i) =>
      frameAt(200 + Math.round(i * (1000 / 30)), 4 * 0.05),
    );
    const verdict = run(detector, [...twitch, ...still]);

    expect(verdict.armed).toBe(true);
    expect(verdict.stop).toBe(false);
  });

  it("never stops a signer who is still moving", () => {
    // The device no longer stops at all - it records a fixed window. Nothing
    // here may cut a sentence that is still in progress.
    const detector = createRestDetector();
    const endless = moving(0, 700, 0.02); // ~23s of continuous movement
    expect(run(detector, endless).stop).toBe(false);
  });

  it("keeps its verdict once it has stopped", () => {
    const detector = createRestDetector();
    const signing = moving(0, 90, 0.02);
    const after = Array.from({ length: 90 }, (_, i) =>
      frameAt(3000 + Math.round(i * (1000 / 30)), 90 * 0.02),
    );
    expect(run(detector, [...signing, ...after]).stop).toBe(true);
    // Frames keep arriving after the decision; none may change it.
    expect(detector.accept(frameAt(9000, 5)).reason).toBe("rest");
  });

  it("starts clean after a reset", () => {
    const detector = createRestDetector();
    run(detector, moving(0, 700, 0.02));
    detector.reset();
    expect(detector.accept(frameAt(0, 0)).stop).toBe(false);
  });
});

describe("framing gate", () => {
  it("needs a face and a body, not hands", () => {
    // A signer waiting for the count has their hands down and often out of
    // shot. Requiring them would stall the countdown indefinitely.
    expect(isInFrame(makeFrame({ leftHand: null, rightHand: null }))).toBe(
      true,
    );
    expect(isInFrame(makeFrame({ face: null }))).toBe(false);
    expect(isInFrame(makeFrame({ pose: null }))).toBe(false);
  });

  it("opens only after a sustained run of frames", () => {
    const gate = createFramingGate(3);
    expect(gate.accept(makeFrame())).toBe(false);
    expect(gate.accept(makeFrame())).toBe(false);
    expect(gate.accept(makeFrame())).toBe(true);
  });

  it("restarts the run when the signer drops out of shot", () => {
    // Detection flickers at the frame edge; one lucky frame is not being in
    // shot, and starting a countdown on it films an empty room.
    const gate = createFramingGate(3);
    gate.accept(makeFrame());
    gate.accept(makeFrame());
    expect(gate.accept(makeFrame({ pose: null }))).toBe(false);
    expect(gate.accept(makeFrame())).toBe(false);
  });
});

describe("block ordering", () => {
  it("hands out each sentence exactly once across consecutive blocks", async () => {
    // Session mode fetches BLOCK_SIZE at a time rather than one prompt at a
    // time. A block that repeated or skipped a sentence would be invisible to
    // the signer, who only ever sees the next thing on the screen.
    const { promptOrderForSigner } = await import("../server/session-service");
    const order = promptOrderForSigner(3);
    const blocks: string[][] = [];
    for (let i = 0; i < order.length; i += BLOCK_SIZE)
      blocks.push(order.slice(i, i + BLOCK_SIZE));

    expect(blocks.flat()).toEqual(order);
    expect(new Set(order).size).toBe(CORPUS_SIZE);
  });

  it("keeps a block balanced across categories", async () => {
    // The order interleaves the five categories so a signer who stops early
    // still leaves a balanced contribution. A block is the unit they actually
    // stop at, so the balance has to survive at that granularity too.
    const { promptOrderForSigner } = await import("../server/session-service");
    const firstBlock = promptOrderForSigner(1).slice(0, BLOCK_SIZE);
    const letters = new Set(firstBlock.map((id) => id[0]));

    expect(letters.size).toBe(CORPUS_CATEGORIES.length);
  });

  it("starts different signers on different categories", async () => {
    const { promptOrderForSigner } = await import("../server/session-service");
    const firsts = [1, 2, 3, 4, 5].map((id) => promptOrderForSigner(id)[0][0]);
    expect(new Set(firsts).size).toBe(CORPUS_CATEGORIES.length);
  });
});

describe("offline trim proposal", () => {
  it("cuts where the stillness began, not where the hold expired", () => {
    // The stop lands at the far end of the hold window. Cutting there would
    // keep the whole hold; the sentence itself ended when the signer stopped.
    const signing = moving(0, 90, 0.02); // 3s of movement
    const resting = Array.from({ length: 120 }, (_, i) =>
      frameAt(3000 + Math.round(i * (1000 / 30)), 90 * 0.02),
    );
    const proposal = proposeTrim([...signing, ...resting]);

    expect(proposal.found).toBe(true);
    expect(proposal.endMs).toBeGreaterThanOrEqual(2900);
    expect(proposal.endMs).toBeLessThan(3000 + REST_HOLD_MS);
    expect(proposal.droppedFrames).toBeGreaterThan(0);
  });

  it("proposes nothing rather than guessing when no rest is found", () => {
    // This is the common case on the run that was measured: hands resting at
    // the waist move at the same speed as slow signing, so no confident
    // resting point exists. Reporting a trim it cannot justify would remove
    // signed content that nothing downstream could recover.
    const proposal = proposeTrim(moving(0, 300, 0.02));

    expect(proposal.found).toBe(false);
    expect(proposal.droppedFrames).toBe(0);
    expect(proposal.endIndex).toBe(299);
  });

  it("leaves a sequence that is entirely still completely alone", () => {
    // Never armed, so nothing is cut - a signer who never started is not a
    // signer who finished.
    const proposal = proposeTrim(
      Array.from({ length: 200 }, (_, i) =>
        frameAt(Math.round(i * (1000 / 30)), 0),
      ),
    );
    expect(proposal.found).toBe(false);
    expect(proposal.droppedFrames).toBe(0);
  });

  it("handles an empty sequence", () => {
    expect(proposeTrim([]).droppedFrames).toBe(0);
  });
});

describe("the recording window", () => {
  it("is long enough for a sentence and its trailing rest", () => {
    // Measured: the three sentences that did end on detected rest ran 5.7s,
    // 8.9s and 9.4s including the rest that ended them. The window has to
    // clear the longest of those with room, because it is now the only thing
    // that ends a sentence.
    expect(RECORDING_WINDOW_MS).toBeGreaterThan(9_400);
  });
});
