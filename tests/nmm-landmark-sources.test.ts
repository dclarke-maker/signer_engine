import { describe, expect, it } from "vitest";

import {
  FACE_BROW_A,
  FACE_BROW_B,
  FACE_EYE_A_INNER,
  FACE_EYE_A_OUTER,
  FACE_EYE_B_INNER,
  FACE_EYE_B_OUTER,
  POSE_EAR_LEFT,
  POSE_EAR_RIGHT,
  POSE_NOSE,
  computeSignerBaseline,
  ocularCentroid,
} from "../server/nmm/baseline";
import { detectNmms } from "../server/nmm/rules";
import { makeNeutralSequence, makePoseFrame } from "./fixtures/landmark-frames";
import { FACE_LANDMARK_COUNT, type LandmarkFrame } from "../shared/landmarks";

/**
 * These pin the anatomy the rules read, not just that they run. Every index
 * here was verified against a real capture: the values the proposal's table
 * lists as "Face: 0" and "Face: 7, 8" are pose indices, and 33/133 are two
 * corners of one eye rather than one eye each.
 */
describe("which landmarks the rules read", () => {
  it("takes the nose and ears from pose, which is where they exist", () => {
    // The face mesh has no ear landmark at any index. Reading face[7] and
    // face[8] gave a point near one eye and the nose bridge, averaged into
    // something that was not on the head's midline.
    expect(POSE_NOSE).toBe(0);
    expect(POSE_EAR_LEFT).toBe(7);
    expect(POSE_EAR_RIGHT).toBe(8);
  });

  it("uses both corners of each eye, on opposite sides of the face", () => {
    expect([FACE_EYE_A_OUTER, FACE_EYE_A_INNER]).toEqual([33, 133]);
    expect([FACE_EYE_B_OUTER, FACE_EYE_B_INNER]).toEqual([263, 362]);
    // Each eye pairs with the brow above it.
    expect(FACE_BROW_A).toBe(105);
    expect(FACE_BROW_B).toBe(334);
  });

  it("puts the ocular centroid between the eyes, not inside one of them", () => {
    const face = makePoseFrame(0).face!;
    const centroid = ocularCentroid(face);
    const eyeA = (face[FACE_EYE_A_OUTER].x + face[FACE_EYE_A_INNER].x) / 2;
    const eyeB = (face[FACE_EYE_B_OUTER].x + face[FACE_EYE_B_INNER].x) / 2;

    expect(centroid.x).toBeGreaterThan(Math.min(eyeA, eyeB));
    expect(centroid.x).toBeLessThan(Math.max(eyeA, eyeB));
  });

  it("reads the whole face mesh, iris landmarks included", () => {
    // 263 and 362 must be within the mesh the decoder accepts.
    expect(FACE_EYE_B_OUTER).toBeLessThan(FACE_LANDMARK_COUNT);
    expect(FACE_EYE_B_INNER).toBeLessThan(FACE_LANDMARK_COUNT);
  });
});

describe("body tilt on a real coordinate layout", () => {
  /** Shoulders level, left at the larger x - the way MediaPipe reports them. */
  const level = (t: number) =>
    makePoseFrame(t, { shoulderL: [0.6, 0.5, 0], shoulderR: [0.4, 0.5, 0] });

  it("reads level shoulders as level", () => {
    // This is the regression. With a signed dx, atan2(0, negative) is pi, so
    // the rule scored roughly 24x its threshold on every frame of every real
    // capture and tagged the whole thing as one maximum-confidence tilt.
    const frames = Array.from({ length: 60 }, (_, i) => level(Math.round(i * (1000 / 30))));
    const detections = detectNmms(frames, { baseline: computeSignerBaseline(frames)! });

    expect(detections.filter((d) => d.type === "body_tilt")).toEqual([]);
  });

  it("still detects a genuine tilt", () => {
    const tilted = (t: number) =>
      makePoseFrame(t, { shoulderL: [0.6, 0.56, 0], shoulderR: [0.4, 0.44, 0] });
    const frames: LandmarkFrame[] = [
      ...Array.from({ length: 30 }, (_, i) => level(Math.round(i * 33))),
      ...Array.from({ length: 30 }, (_, i) => tilted(1000 + Math.round(i * 33))),
    ];
    const detections = detectNmms(frames, { baseline: computeSignerBaseline(makeNeutralSequence(30))! });

    expect(detections.map((d) => d.type)).toContain("body_tilt");
  });

  it("gives the same answer whichever shoulder is at the larger x", () => {
    // A mirrored front camera swaps them; the tilt is the same tilt.
    const straight = Array.from({ length: 40 }, (_, i) =>
      makePoseFrame(Math.round(i * 33), { shoulderL: [0.6, 0.55, 0], shoulderR: [0.4, 0.45, 0] }),
    );
    const swapped = Array.from({ length: 40 }, (_, i) =>
      makePoseFrame(Math.round(i * 33), { shoulderL: [0.4, 0.45, 0], shoulderR: [0.6, 0.55, 0] }),
    );

    const tiltsIn = (frames: LandmarkFrame[]) =>
      detectNmms(frames, { baseline: computeSignerBaseline(frames)! })
        .filter((d) => d.type === "body_tilt")
        .map((d) => [d.startFrame, d.endFrame]);

    expect(tiltsIn(swapped)).toEqual(tiltsIn(straight));
  });
});

describe("landmarks the model says it cannot see", () => {
  const hidden = (frames: LandmarkFrame[], indices: number[]) =>
    frames.map((f) => ({
      ...f,
      pose: f.pose!.map((p, i) => (indices.includes(i) ? { ...p, visibility: 0.001 } : p)),
    }));

  it("declines to infer a lean from hips that are out of frame", () => {
    // Measured on a real head-and-shoulders capture: MediaPipe reported hip
    // visibility of 0.001 on every frame and forward_lean, which is nothing but
    // shoulder-to-hip depth, produced twelve confident tags from the
    // extrapolated coordinates.
    const lean = (t: number) =>
      makePoseFrame(t, { hipL: [0.58, 0.8, 0.9], hipR: [0.42, 0.8, 0.9] });
    const frames = [
      ...makeNeutralSequence(30),
      ...Array.from({ length: 30 }, (_, i) => lean(1000 + i * 33)),
    ];

    const seen = detectNmms(frames, { baseline: computeSignerBaseline(frames)! });
    expect(seen.map((d) => d.type)).toContain("forward_lean");

    const blind = hidden(frames, [23, 24]);
    const tags = detectNmms(blind, { baseline: computeSignerBaseline(blind)! });
    expect(tags.filter((d) => d.type === "forward_lean")).toEqual([]);
  });

  it("keeps measuring the markers whose landmarks are still visible", () => {
    // Hidden hips must not silence the rules that never needed them.
    const raise = (t: number) =>
      makePoseFrame(t, { browL: [0.55, 0.24, 0], browR: [0.45, 0.24, 0] });
    const frames = [
      ...makeNeutralSequence(15),
      ...Array.from({ length: 25 }, (_, i) => raise(500 + i * 33)),
    ];
    const blind = hidden(frames, [23, 24]);

    const tags = detectNmms(blind, { baseline: computeSignerBaseline(blind)! });
    expect(tags.map((d) => d.type)).toContain("eyebrow_raise");
  });

  it("treats a landmark with no visibility score as visible", () => {
    // The face mesh carries no score; absent is not evidence of occlusion.
    const frames = makeNeutralSequence(40).map((f) => ({
      ...f,
      pose: f.pose!.map(({ x, y, z }) => ({ x, y, z })),
    }));
    expect(computeSignerBaseline(frames)).not.toBeNull();
  });
});
