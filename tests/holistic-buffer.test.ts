import { describe, expect, it } from "vitest";

import {
  HOLISTIC_BUFFER_VERSION,
  HOLISTIC_HEADER_FLOATS,
  HolisticBufferError,
  decodeHolisticBuffer,
  encodeHolisticBuffer,
} from "../lib/extractors/holistic-buffer";
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
} from "../shared/landmarks";

const pts = (n: number, tag: number): Landmark[] =>
  Array.from({ length: n }, (_, i) => ({ x: tag, y: i / 1000, z: -tag, visibility: 0.5 }));

const complete = () => ({
  t: 1234,
  face: pts(FACE_LANDMARK_COUNT, 1),
  pose: pts(POSE_LANDMARK_COUNT, 2),
  leftHand: pts(HAND_LANDMARK_COUNT, 3),
  rightHand: pts(HAND_LANDMARK_COUNT, 4),
});

describe("holistic buffer codec", () => {
  it("round-trips a complete frame", () => {
    const frame = decodeHolisticBuffer(encodeHolisticBuffer(complete()), { mirrored: false });
    expect(frame.t).toBe(1234);
    expect(frame.face).toHaveLength(FACE_LANDMARK_COUNT);
    expect(frame.pose).toHaveLength(POSE_LANDMARK_COUNT);
    expect(frame.leftHand).toHaveLength(HAND_LANDMARK_COUNT);
    expect(frame.rightHand).toHaveLength(HAND_LANDMARK_COUNT);
    expect(frame.pose![0]).toEqual({ x: 2, y: 0, z: -2, visibility: 0.5 });
  });

  it("packs a complete frame into the expected number of floats", () => {
    const expected =
      HOLISTIC_HEADER_FLOATS +
      (FACE_LANDMARK_COUNT + POSE_LANDMARK_COUNT + HAND_LANDMARK_COUNT * 2) * 4;
    expect(new Float32Array(encodeHolisticBuffer(complete())).length).toBe(expected);
  });

  it("round-trips absent streams as null, not empty arrays", () => {
    const frame = decodeHolisticBuffer(
      encodeHolisticBuffer({ ...complete(), leftHand: null, face: null }),
      { mirrored: false },
    );
    expect(frame.leftHand).toBeNull();
    expect(frame.face).toBeNull();
    expect(frame.pose).not.toBeNull();
    expect(frame.rightHand).not.toBeNull();
  });

  it("swaps hands when the camera image is mirrored", () => {
    const plain = decodeHolisticBuffer(encodeHolisticBuffer(complete()), { mirrored: false });
    const mirrored = decodeHolisticBuffer(encodeHolisticBuffer(complete()), { mirrored: true });
    expect(plain.leftHand![0].x).toBe(3);
    expect(mirrored.leftHand![0].x).toBe(4);
    expect(mirrored.rightHand![0].x).toBe(3);
  });

  it("keeps stream order stable when only the middle stream is missing", () => {
    const frame = decodeHolisticBuffer(
      encodeHolisticBuffer({ ...complete(), pose: null }),
      { mirrored: false },
    );
    // Offsets must shift, not misalign: the hands must still read their own tags.
    expect(frame.pose).toBeNull();
    expect(frame.face![0].x).toBe(1);
    expect(frame.leftHand![0].x).toBe(3);
    expect(frame.rightHand![0].x).toBe(4);
  });

  it("rejects an unsupported schema version rather than misreading it", () => {
    const data = new Float32Array(encodeHolisticBuffer(complete()));
    data[0] = 99;
    expect(() => decodeHolisticBuffer(data.buffer, { mirrored: false })).toThrow(
      /Unsupported holistic buffer version 99/,
    );
  });

  it("rejects a wrong landmark count instead of truncating", () => {
    const data = new Float32Array(encodeHolisticBuffer(complete()));
    data[3] = POSE_LANDMARK_COUNT - 5;
    expect(() => decodeHolisticBuffer(data.buffer, { mirrored: false })).toThrow(
      HolisticBufferError,
    );
  });

  it("rejects a buffer that ends mid-stream", () => {
    const full = new Float32Array(encodeHolisticBuffer(complete()));
    const truncated = full.slice(0, full.length - 20);
    expect(() => decodeHolisticBuffer(truncated.buffer, { mirrored: false })).toThrow(
      /ended mid-stream/,
    );
  });

  it("rejects a buffer shorter than the header", () => {
    expect(() => decodeHolisticBuffer(new Float32Array(3).buffer, { mirrored: false })).toThrow(
      /shorter than the header/,
    );
  });

  it("writes the version and counts where the native plugin must write them", () => {
    const data = new Float32Array(encodeHolisticBuffer(complete()));
    expect(data[0]).toBe(HOLISTIC_BUFFER_VERSION);
    expect(data[1]).toBe(1234);
    expect([data[2], data[3], data[4], data[5]]).toEqual([
      FACE_LANDMARK_COUNT,
      POSE_LANDMARK_COUNT,
      HAND_LANDMARK_COUNT,
      HAND_LANDMARK_COUNT,
    ]);
  });

  it("defaults visibility to 1 when a landmark omits it", () => {
    const noVis = { ...complete(), pose: [{ x: 0, y: 0, z: 0 }] as Landmark[] };
    const data = new Float32Array(encodeHolisticBuffer(noVis));
    // pose sits after the face block
    const poseBase = HOLISTIC_HEADER_FLOATS + FACE_LANDMARK_COUNT * 4;
    expect(data[poseBase + 3]).toBe(1);
  });
});
