import { describe, expect, it } from "vitest";

import { computeSignerBaseline } from "../server/nmm/baseline";
import { toIsotropic } from "../server/nmm/isotropic";
import { detectNmms } from "../server/nmm/rules";
import { makeNeutralSequence, makePoseFrame } from "./fixtures/landmark-frames";
import type { Landmark, LandmarkFrame } from "../shared/landmarks";

/**
 * Re-expresses a square-space fixture as the frame a camera of this aspect
 * would actually produce.
 *
 * MediaPipe divides x by frame width and y by frame height, so on a frame
 * narrower than it is tall the same physical scene comes back with x
 * compressed. Dividing by the aspect is the inverse of what `toIsotropic`
 * does, which makes these fixtures the same gesture seen through a different
 * lens rather than a different gesture.
 */
function anamorphic(frame: LandmarkFrame, aspect: number): LandmarkFrame {
  const squash = (s: Landmark[] | null) =>
    s === null ? null : s.map((p) => ({ ...p, x: p.x / aspect, z: p.z / aspect }));
  return {
    ...frame,
    aspect,
    face: squash(frame.face),
    pose: squash(frame.pose),
    leftHand: squash(frame.leftHand),
    rightHand: squash(frame.rightHand),
  };
}

const asSeen = (frames: LandmarkFrame[], aspect: number) =>
  frames.map((f) => anamorphic(f, aspect));

/** A raise held long enough to clear the minimum-frames gate. */
const raiseSequence = () => [
  ...makeNeutralSequence(15),
  ...Array.from({ length: 20 }, (_, i) =>
    makePoseFrame(500 + i * 33, { browL: [0.45, 0.24, 0], browR: [0.55, 0.24, 0] }),
  ),
];

// 9:16 portrait and 3:4, the two shapes a study phone or tablet actually
// produces. 1 is the square space the fixtures are written in.
const ASPECTS = [9 / 16, 3 / 4];

describe("aspect ratio correction", () => {
  it("undoes the camera's horizontal squash", () => {
    const square = makePoseFrame(0);
    const restored = toIsotropic(anamorphic(square, 9 / 16));

    expect(restored.pose![11].x).toBeCloseTo(square.pose![11].x, 6);
    expect(restored.pose![11].z).toBeCloseTo(square.pose![11].z, 6);
    expect(restored.face![0].y).toBeCloseTo(square.face![0].y, 6);
  });

  it("leaves a square frame untouched", () => {
    const square = makePoseFrame(0);
    expect(toIsotropic(square)).toBe(square);
  });

  it.each(ASPECTS)("derives the same baseline at aspect %s as in square space", (aspect) => {
    const square = computeSignerBaseline(makeNeutralSequence(30))!;
    const seen = computeSignerBaseline(asSeen(makeNeutralSequence(30), aspect))!;

    expect(seen.shoulderWidth).toBeCloseTo(square.shoulderWidth, 6);
    expect(seen.neutralBrowGap).toBeCloseTo(square.neutralBrowGap, 6);
    expect(seen.neutralShoulderEarGap).toBeCloseTo(square.neutralShoulderEarGap, 6);
    expect(seen.neutralDepthDelta).toBeCloseTo(square.neutralDepthDelta, 6);
  });

  it.each(ASPECTS)("tags the same gesture identically at aspect %s", (aspect) => {
    const baseline = computeSignerBaseline(makeNeutralSequence(30))!;
    const square = detectNmms(raiseSequence(), { baseline });
    const seen = detectNmms(asSeen(raiseSequence(), aspect), {
      baseline: computeSignerBaseline(asSeen(makeNeutralSequence(30), aspect))!,
    });

    expect(square.map((d) => d.type)).toContain("eyebrow_raise");
    expect(seen.map((d) => ({ type: d.type, startFrame: d.startFrame, endFrame: d.endFrame })))
      .toEqual(square.map((d) => ({ type: d.type, startFrame: d.startFrame, endFrame: d.endFrame })));
  });

  it("would read a different brow gap if the aspect were ignored", () => {
    // Guards the correction itself: if toIsotropic became a no-op, the test
    // above would still pass by comparing two identical wrong answers.
    const seen = asSeen(makeNeutralSequence(30), 9 / 16);
    const honest = computeSignerBaseline(seen)!;
    const ignored = computeSignerBaseline(seen.map((f) => ({ ...f, aspect: 1 })))!;

    expect(ignored.neutralBrowGap).not.toBeCloseTo(honest.neutralBrowGap, 3);
  });

  it("reads a level shoulder line as level whatever the frame shape", () => {
    // body_tilt takes atan2 of two components that are scaled differently, so
    // it is the rule most exposed to this.
    const baseline = computeSignerBaseline(makeNeutralSequence(30))!;
    for (const aspect of ASPECTS) {
      const seen = asSeen(makeNeutralSequence(60), aspect);
      const tilts = detectNmms(seen, {
        baseline: computeSignerBaseline(seen)!,
      }).filter((d) => d.type === "body_tilt");
      expect(tilts).toEqual([]);
    }
    expect(detectNmms(makeNeutralSequence(60), { baseline })).toEqual([]);
  });
});
