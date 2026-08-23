import { describe, expect, it } from "vitest";

import {
  HOLISTIC_BUFFER_VERSION,
  HOLISTIC_HEADER_FLOATS,
  HolisticBufferError,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  decodeHolisticBase64,
  decodeHolisticBuffer,
  encodeHolisticBase64,
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
    const frame = decodeHolisticBuffer(encodeHolisticBuffer(complete()));
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
    );
    expect(frame.leftHand).toBeNull();
    expect(frame.face).toBeNull();
    expect(frame.pose).not.toBeNull();
    expect(frame.rightHand).not.toBeNull();
  });

  it("swaps hands when the frame says its pixels are mirrored", () => {
    const plain = decodeHolisticBuffer(encodeHolisticBuffer(complete()));
    const mirrored = decodeHolisticBuffer(
      encodeHolisticBuffer({ ...complete(), mirrored: true }),
    );
    expect(plain.leftHand![0].x).toBe(3);
    expect(mirrored.leftHand![0].x).toBe(4);
    expect(mirrored.rightHand![0].x).toBe(3);
  });

  it("keeps stream order stable when only the middle stream is missing", () => {
    const frame = decodeHolisticBuffer(
      encodeHolisticBuffer({ ...complete(), pose: null }),
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
    expect(() => decodeHolisticBuffer(data.buffer)).toThrow(
      /Unsupported holistic buffer version 99/,
    );
  });

  it("rejects a wrong landmark count instead of truncating", () => {
    const data = new Float32Array(encodeHolisticBuffer(complete()));
    data[3] = POSE_LANDMARK_COUNT - 5;
    expect(() => decodeHolisticBuffer(data.buffer)).toThrow(
      HolisticBufferError,
    );
  });

  it("rejects a buffer that ends mid-stream", () => {
    const full = new Float32Array(encodeHolisticBuffer(complete()));
    const truncated = full.slice(0, full.length - 20);
    expect(() => decodeHolisticBuffer(truncated.buffer)).toThrow(
      /ended mid-stream/,
    );
  });

  it("rejects a buffer shorter than the header", () => {
    expect(() => decodeHolisticBuffer(new Float32Array(3).buffer)).toThrow(
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

describe("base64 transport", () => {
  // The frame processor's result reaches JS through createRunOnJS, which
  // rejects ArrayBuffers as shared values, so the packed bytes travel as a
  // string. These tests pin that encoding, because a mismatch between the
  // native writers and this reader shows up only as silently dropped frames.
  it("round-trips a complete frame through base64", () => {
    const frame = decodeHolisticBase64(encodeHolisticBase64(complete()));

    expect(frame.t).toBe(1234);
    expect(frame.face).toHaveLength(FACE_LANDMARK_COUNT);
    expect(frame.pose).toHaveLength(POSE_LANDMARK_COUNT);
    expect(frame.leftHand?.[0]).toEqual({ x: 3, y: 0, z: -3, visibility: 0.5 });
    expect(frame.rightHand?.[0]).toEqual({ x: 4, y: 0, z: -4, visibility: 0.5 });
  });

  it("still swaps hands when mirrored", () => {
    const frame = decodeHolisticBase64(encodeHolisticBase64({ ...complete(), mirrored: true }));
    expect(frame.leftHand?.[0].x).toBe(4);
    expect(frame.rightHand?.[0].x).toBe(3);
  });

  it("encodes the header little-endian, as the native writers must", () => {
    // A header-only frame: version 2, timestamp 2, four zero counts, aspect 1,
    // not mirrored.
    // 1.0f = 0x3F800000 and 2.0f = 0x40000000, little-endian byte order.
    const packed = encodeHolisticBase64({
      t: 2,
      face: null,
      pose: null,
      leftHand: null,
      rightHand: null,
    });

    expect(Array.from(new Uint8Array(base64ToArrayBuffer(packed)))).toEqual([
      0x00, 0x00, 0x00, 0x40, // version 2
      0x00, 0x00, 0x00, 0x40, // t 2
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // four zero counts
      0x00, 0x00, 0x80, 0x3f, // aspect 1, the default for square-space input
      0, 0, 0, 0, // not mirrored
    ]);
    expect(packed).toBe("AAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAACAPwAAAAA=");
  });

  it("carries the aspect ratio the frame was normalised against", () => {
    const frame = decodeHolisticBase64(encodeHolisticBase64({ ...complete(), aspect: 9 / 16 }));
    expect(frame.aspect).toBeCloseTo(9 / 16, 6);
  });

  it("rejects a frame whose aspect ratio is missing or nonsensical", () => {
    // Zero is what a writer that never set the field would leave behind, and
    // dividing by it downstream would silently produce infinities.
    expect(() =>
      decodeHolisticBase64(encodeHolisticBase64({ ...complete(), aspect: 0 })),
    ).toThrow(HolisticBufferError);
  });

  it("pads base64 the way the native encoders do", () => {
    // Byte counts not divisible by three are where hand-rolled encoders and
    // platform ones tend to disagree.
    expect(arrayBufferToBase64(new Uint8Array([1]).buffer)).toBe("AQ==");
    expect(arrayBufferToBase64(new Uint8Array([1, 2]).buffer)).toBe("AQI=");
    expect(arrayBufferToBase64(new Uint8Array([1, 2, 3]).buffer)).toBe("AQID");
    for (const s of ["AQ==", "AQI=", "AQID"]) {
      expect(arrayBufferToBase64(base64ToArrayBuffer(s))).toBe(s);
    }
  });

  it("rejects a payload that is not base64", () => {
    expect(() => decodeHolisticBase64("not base64!")).toThrow(
      HolisticBufferError,
    );
  });

  it("rejects a payload that is not a whole number of floats", () => {
    // Five bytes: enough to decode, but not a float32 boundary.
    expect(() =>
      decodeHolisticBase64(arrayBufferToBase64(new Uint8Array(5).buffer)),
    ).toThrow(HolisticBufferError);
  });
});
