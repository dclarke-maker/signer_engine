import {
  FACE_LANDMARK_COUNTS,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
} from "@/shared/landmarks";

/**
 * Wire format between the native frame processor and JS.
 *
 * A holistic result is roughly 543 landmarks; as nested JS objects that is
 * ~1600 allocations per frame crossing the bridge at 30fps. The plugin packs
 * one flat Float32Array instead and this module unpacks it.
 *
 * **Why the bytes travel as base64.** The frame processor runs in a worklet
 * runtime, and its result reaches JS through `Worklets.createRunOnJS`, which
 * converts every argument to a worklets-core shared value. That converter
 * rejects ArrayBuffers outright ("Array buffers are not supported as shared
 * values") and wraps arrays element by element, which for ~2200 floats a frame
 * is exactly the per-element bridging the packed layout exists to avoid. A
 * string is copied whole, so the native side base64-encodes the packed bytes
 * and `decodeHolisticBase64` turns them back into the buffer below.
 *
 * The encoding costs about 11.6 KB and 0.1 ms per frame - roughly 3 ms for
 * every second captured at 25fps - so it is not a meaningful share of the
 * frame budget.
 *
 * The layout is little-endian on every platform, stated rather than inherited:
 * the native writers pin the byte order explicitly so the reader here does not
 * depend on the host's.
 *
 * Layout, all float32:
 *   [0] schema version
 *   [1] timestamp, milliseconds from the plugin's monotonic clock. The plugin
 *       outlives a capture, so the extractor rebases it on each capture's
 *       first frame; the value here is not zero at the start of a capture.
 *   [2] face count        (0, 468, or 478 with iris)
 *   [3] pose count        (0 or 33)
 *   [4] left hand count   (0 or 21)
 *   [5] right hand count  (0 or 21)
 *   [6] frame aspect, width / height, after rotation. x is normalised by width
 *       and y by height, so nothing may compare or divide the two without it.
 *   [7] 1 when the frame's pixels are horizontally flipped, else 0. MediaPipe
 *       names the hands anatomically, so a mirrored frame yields the labels of
 *       a mirrored person and the two have to be swapped back.
 *   then face, pose, left hand, right hand in order,
 *   four floats per landmark: x, y, z, visibility
 *
 * A count of 0 means the stream was not detected in that frame. Any other
 * unexpected count is rejected rather than truncated - the §5 rules index
 * landmarks by position, so a short array would read the wrong anatomy. Face
 * accepts 468 or 478; see FACE_LANDMARK_COUNTS.
 */
/**
 * Bumped to 2 when the aspect ratio joined the header. The decoder rejects any
 * other version outright, which is what stops a native writer built against the
 * old layout from being read as the new one.
 */
export const HOLISTIC_BUFFER_VERSION = 2;
export const HOLISTIC_HEADER_FLOATS = 8;
const FLOATS_PER_LANDMARK = 4;

type StreamSpec = { key: "face" | "pose" | "leftHand" | "rightHand"; expected: number[] };

/** Order is part of the wire format and must match the native writer. */
const STREAMS: StreamSpec[] = [
  { key: "face", expected: FACE_LANDMARK_COUNTS },
  { key: "pose", expected: [POSE_LANDMARK_COUNT] },
  { key: "leftHand", expected: [HAND_LANDMARK_COUNT] },
  { key: "rightHand", expected: [HAND_LANDMARK_COUNT] },
];

export class HolisticBufferError extends Error {}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Reverse lookup for base64 decoding, built once. Values outside the alphabet
 * map to -1 so a corrupt payload is rejected rather than decoded into
 * plausible-looking coordinates.
 */
const BASE64_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decodes base64 to bytes.
 *
 * Hand-rolled rather than using `atob` or `Buffer`: neither is guaranteed
 * across Hermes, Node, and the browser build, and this runs on every frame, so
 * a predictable implementation is worth more than a shorter one.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  let end = base64.length;
  while (end > 0 && base64[end - 1] === "=") end -= 1;

  const byteLength = Math.floor((end * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  let accumulator = 0;
  let bitsHeld = 0;

  for (let i = 0; i < end; i += 1) {
    const code = base64.charCodeAt(i);
    const value = code < 128 ? BASE64_LOOKUP[code] : -1;
    if (value < 0) {
      throw new HolisticBufferError(`Packed frame contains a non-base64 character at ${i}.`);
    }
    accumulator = (accumulator << 6) | value;
    bitsHeld += 6;
    if (bitsHeld >= 8) {
      bitsHeld -= 8;
      bytes[byteIndex] = (accumulator >> bitsHeld) & 0xff;
      byteIndex += 1;
    }
  }

  return bytes.buffer;
}

/** Encodes bytes as base64. Exists so the codec can be round-tripped in tests. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const b0 = bytes[i];
    const b1 = remaining > 1 ? bytes[i + 1] : 0;
    const b2 = remaining > 2 ? bytes[i + 2] : 0;

    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += remaining > 1 ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += remaining > 2 ? BASE64_ALPHABET[b2 & 0x3f] : "=";
  }

  return out;
}

function readStream(
  data: Float32Array,
  offset: number,
  count: number,
  expected: number[],
  label: string,
): { landmarks: Landmark[] | null; next: number } {
  if (count === 0) return { landmarks: null, next: offset };
  if (!expected.includes(count)) {
    throw new HolisticBufferError(
      `${label} reported ${count} landmarks, expected ${expected.join(" or ")} or 0.`,
    );
  }
  const end = offset + count * FLOATS_PER_LANDMARK;
  if (end > data.length) {
    throw new HolisticBufferError(`Buffer ended mid-stream while reading ${label}.`);
  }

  const landmarks: Landmark[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const base = offset + i * FLOATS_PER_LANDMARK;
    landmarks[i] = {
      x: data[base],
      y: data[base + 1],
      z: data[base + 2],
      visibility: data[base + 3],
    };
  }
  return { landmarks, next: end };
}

/**
 * Decodes one packed frame.
 *
 * Whether the hands are swapped is read from the frame rather than configured.
 * MediaPipe names hands anatomically, so it is only wrong when the pixels
 * themselves are flipped - which is a property of the lens and the platform,
 * not of the app. A front camera on one platform delivers a mirrored analysis
 * buffer and on another does not, and an external webcam usually does not, so
 * assuming any single answer mislabels every hand in the corpus on some
 * hardware. Left and right are not incidental in a sign language.
 */
export function decodeHolisticBuffer(buffer: ArrayBuffer): LandmarkFrame {
  const data = new Float32Array(buffer);
  if (data.length < HOLISTIC_HEADER_FLOATS) {
    throw new HolisticBufferError("Buffer is shorter than the header.");
  }

  const version = data[0];
  if (version !== HOLISTIC_BUFFER_VERSION) {
    throw new HolisticBufferError(
      `Unsupported holistic buffer version ${version}; expected ${HOLISTIC_BUFFER_VERSION}.`,
    );
  }

  const t = data[1];
  const counts = [data[2], data[3], data[4], data[5]];
  const aspect = data[6];
  if (!(aspect > 0)) {
    throw new HolisticBufferError(`Frame reported a non-positive aspect ratio of ${aspect}.`);
  }
  const mirrored = data[7] !== 0;

  let offset = HOLISTIC_HEADER_FLOATS;
  const streams: Record<string, Landmark[] | null> = {};
  STREAMS.forEach((spec, i) => {
    const result = readStream(data, offset, counts[i], spec.expected, spec.key);
    streams[spec.key] = result.landmarks;
    offset = result.next;
  });

  return {
    t,
    aspect,
    face: streams.face,
    pose: streams.pose,
    leftHand: mirrored ? streams.rightHand : streams.leftHand,
    rightHand: mirrored ? streams.leftHand : streams.rightHand,
  };
}

/**
 * Decodes one packed frame delivered as base64. This is the form the native
 * plugins actually return; see the note on the wire format above.
 */
export function decodeHolisticBase64(base64: string): LandmarkFrame {
  const buffer = base64ToArrayBuffer(base64);
  if (buffer.byteLength % 4 !== 0) {
    throw new HolisticBufferError(
      `Packed frame is ${buffer.byteLength} bytes, which is not a whole number of float32s.`,
    );
  }
  return decodeHolisticBuffer(buffer);
}

/**
 * Produces the same layout the native plugin writes. Exists so the codec can be
 * round-tripped in tests without a device, and so the native implementations
 * have an executable specification to match.
 */
export function encodeHolisticBuffer(input: {
  t: number;
  face: Landmark[] | null;
  pose: Landmark[] | null;
  leftHand: Landmark[] | null;
  rightHand: Landmark[] | null;
  /** Defaults to 1 so square-space fixtures need not state it. */
  aspect?: number;
  /** Defaults to false: an unflipped frame needs no correction. */
  mirrored?: boolean;
}): ArrayBuffer {
  const ordered = STREAMS.map((spec) => input[spec.key]);
  const total =
    HOLISTIC_HEADER_FLOATS +
    ordered.reduce((sum, s) => sum + (s?.length ?? 0) * FLOATS_PER_LANDMARK, 0);

  const data = new Float32Array(total);
  data[0] = HOLISTIC_BUFFER_VERSION;
  data[1] = input.t;
  ordered.forEach((stream, i) => {
    data[2 + i] = stream?.length ?? 0;
  });
  data[6] = input.aspect ?? 1;
  data[7] = input.mirrored ? 1 : 0;

  let offset = HOLISTIC_HEADER_FLOATS;
  for (const stream of ordered) {
    if (!stream) continue;
    for (const p of stream) {
      data[offset] = p.x;
      data[offset + 1] = p.y;
      data[offset + 2] = p.z;
      data[offset + 3] = p.visibility ?? 1;
      offset += FLOATS_PER_LANDMARK;
    }
  }
  return data.buffer;
}

/** The base64 form of `encodeHolisticBuffer`, matching what the plugins send. */
export function encodeHolisticBase64(input: Parameters<typeof encodeHolisticBuffer>[0]): string {
  return arrayBufferToBase64(encodeHolisticBuffer(input));
}
