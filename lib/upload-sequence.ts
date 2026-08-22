import { getApiBaseUrl } from "@/constants/oauth";
import { getSignerSessionToken } from "@/lib/signer-session";
import type { LandmarkSequencePayload } from "@/shared/landmarks";

export type UploadResult = { sessionId: string; status: string; nmmTags: number };

/**
 * Sends the coordinate sequence, sentence label, and category - and nothing
 * else. No frame, image, or audio sample ever reaches this function.
 */
export async function uploadSequence(payload: LandmarkSequencePayload): Promise<UploadResult> {
  const token = await getSignerSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/api/sessions/${payload.sessionId}/sequence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The sequence could not be submitted.");
  }
  return (await response.json()) as UploadResult;
}
