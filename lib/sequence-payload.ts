import { gzipSync } from "fflate";

import type { Landmark, LandmarkSequencePayload } from "@/shared/landmarks";

/**
 * Turns a sequence into the bytes that go on the wire.
 *
 * Kept apart from `upload-sequence.ts` so it can be tested: that module reaches
 * the API base URL and the session store, which pull in React Native, whose
 * Flow-typed source vitest cannot parse. This file imports nothing but types.
 */

/**
 * Decimal places kept on every coordinate.
 *
 * MediaPipe emits float64, which serialises as `0.6392536163330078` - about a
 * hundred bytes per landmark, for a number whose useful precision is far
 * coarser. Coordinates are normalised to the frame, so 1e-5 is a hundredth of a
 * pixel on a 1080-pixel frame: well below anything the model resolves, and well
 * below the noise in a hand landmark. Five places is therefore lossless for this
 * pipeline and removes roughly half the bytes before compression.
 */
export const COORDINATE_DECIMALS = 5;

const round = (n: number) => Number(n.toFixed(COORDINATE_DECIMALS));

/**
 * Shrinks the payload without changing what it means.
 *
 * Without this a fifteen-second sentence at the target thirty frames a second,
 * with a face detected, serialises to about 24 MB - over the server's own limit,
 * so the first real sentence of collection failed to upload at all. Signers also
 * send a hundred of these over their own mobile data.
 */
export function encodeSequenceBody(payload: LandmarkSequencePayload): Uint8Array {
  const stream = (points: Landmark[] | null) =>
    points === null
      ? null
      : points.map((p) =>
          // A visibility the model did not supply must not be invented here:
          // absent and 1 mean different things to whatever reads this later.
          p.visibility === undefined
            ? { x: round(p.x), y: round(p.y), z: round(p.z) }
            : { x: round(p.x), y: round(p.y), z: round(p.z), visibility: round(p.visibility) },
        );

  const frames = payload.frames.map((frame) => ({
    ...frame,
    face: stream(frame.face),
    pose: stream(frame.pose),
    leftHand: stream(frame.leftHand),
    rightHand: stream(frame.rightHand),
  }));

  const json = JSON.stringify({ ...payload, frames });
  // level 6: level 9 costs noticeably more time on a phone for about a percent
  // of size on this kind of numeric JSON.
  return gzipSync(new TextEncoder().encode(json), { level: 6 });
}
