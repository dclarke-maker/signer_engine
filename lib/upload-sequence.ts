import { getApiBaseUrl } from "@/constants/oauth";
import { encodeSequenceBody } from "@/lib/sequence-payload";
import { getSignerSessionToken } from "@/lib/signer-session";
import type { LandmarkSequencePayload } from "@/shared/landmarks";

export type UploadResult = { sessionId: string; status: string; nmmTags: number };

/**
 * Sends the coordinate sequence, sentence label, and category - and nothing
 * else. No frame, image, or audio sample ever reaches this function.
 *
 * The body is gzipped, which the upload route already expects; see
 * lib/sequence-payload.ts for why it has to be.
 */
export async function uploadSequence(payload: LandmarkSequencePayload): Promise<UploadResult> {
  const token = await getSignerSessionToken();
  // slice() so the ArrayBuffer is exactly the gzip output: handing over the
  // backing buffer of a view would send whatever else shares it.
  const body = encodeSequenceBody(payload).slice().buffer as ArrayBuffer;

  const response = await fetch(`${getApiBaseUrl()}/api/sessions/${payload.sessionId}/sequence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/gzip",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
    credentials: "include",
  });

  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(failure.error ?? "The sequence could not be submitted.");
  }
  return (await response.json()) as UploadResult;
}
