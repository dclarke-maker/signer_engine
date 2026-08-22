import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
} from "@/shared/landmarks";

/**
 * Wire format between the native frame processor and JS.
 *
 * A holistic result is roughly 543 landmarks; as nested JS objects that is
 * ~1600 allocations per frame crossing the bridge at 30fps. Vision Camera
 * permits an ArrayBuffer return, so the plugin packs one flat Float32Array
 * instead and this module unpacks it.
 *
 * Layout, all float32:
 *   [0] schema version
 *   [1] timestamp, milliseconds since capture start
 *   [2] face count        (0 or 468)
 *   [3] pose count        (0 or 33)
 *   [4] left hand count   (0 or 21)
 *   [5] right hand count  (0 or 21)
 *   then face, pose, left hand, right hand in order,
 *   four floats per landmark: x, y, z, visibility
 *
 * A count of 0 means the stream was not detected in that frame. Any other
 * unexpected count is rejected rather than truncated - the §5 rules index
 * landmarks by position, so a short array would read the wrong anatomy.
 */
export const HOLISTIC_BUFFER_VERSION = 1;
export const HOLISTIC_HEADER_FLOATS = 6;
const FLOATS_PER_LANDMARK = 4;

type StreamSpec = { key: "face" | "pose" | "leftHand" | "rightHand"; expected: number };

/** Order is part of the wire format and must match the native writer. */
const STREAMS: StreamSpec[] = [
  { key: "face", expected: FACE_LANDMARK_COUNT },
  { key: "pose", expected: POSE_LANDMARK_COUNT },
  { key: "leftHand", expected: HAND_LANDMARK_COUNT },
  { key: "rightHand", expected: HAND_LANDMARK_COUNT },
];

export class HolisticBufferError extends Error {}

function readStream(
  data: Float32Array,
  offset: number,
  count: number,
  expected: number,
  label: string,
): { landmarks: Landmark[] | null; next: number } {
  if (count === 0) return { landmarks: null, next: offset };
  if (count !== expected) {
    throw new HolisticBufferError(
      `${label} reported ${count} landmarks, expected ${expected} or 0.`,
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
 * Decodes one packed frame. `mirrored` swaps the hands: MediaPipe labels them
 * from the camera's point of view, and a front camera mirrors the image, so
 * the signer's left hand arrives labelled right.
 */
export function decodeHolisticBuffer(
  buffer: ArrayBuffer,
  options: { mirrored: boolean },
): LandmarkFrame {
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

  let offset = HOLISTIC_HEADER_FLOATS;
  const streams: Record<string, Landmark[] | null> = {};
  STREAMS.forEach((spec, i) => {
    const result = readStream(data, offset, counts[i], spec.expected, spec.key);
    streams[spec.key] = result.landmarks;
    offset = result.next;
  });

  return {
    t,
    face: streams.face,
    pose: streams.pose,
    leftHand: options.mirrored ? streams.rightHand : streams.leftHand,
    rightHand: options.mirrored ? streams.leftHand : streams.rightHand,
  };
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
