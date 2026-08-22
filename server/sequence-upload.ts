import express, { type Express } from "express";
import { gunzipSync } from "node:zlib";

import { requireCurrentConsent } from "./consent-service";
import { computeSignerBaseline } from "./nmm/baseline";
import { detectNmms } from "./nmm/rules";
import { putLandmarkSequence, sequenceObjectKey } from "./sequence-storage";
import { getCaptureSession, storeSequenceForSession } from "./session-service";
import { extractBearerToken } from "./signer-security";
import { getSignerFromSessionToken } from "./signer-service";
import type { LandmarkSequencePayload } from "../shared/landmarks";

/** 30 fps of gzipped landmark JSON for a minute of signing sits well inside this. */
export const MAX_SEQUENCE_BYTES = 24 * 1024 * 1024;

type Rejection = { status: number; message: string };

/**
 * Pure authorization and validation gate. Deterministic and DB-free so the whole
 * decision table is unit-testable without a request, a session, or a database.
 */
export function resolveUploadRejection(input: {
  signer: { id: number } | null;
  session: { id: string; signerId: number; status: string } | null;
  byteLength: number;
  contentType: string | undefined;
}): Rejection | null {
  if (!input.signer) return { status: 401, message: "Sign in before submitting a sequence." };
  if (!input.session) return { status: 404, message: "The capture session was not found." };
  if (input.session.signerId !== input.signer.id) {
    return { status: 403, message: "This session belongs to another signer." };
  }
  if (input.session.status !== "recording" && input.session.status !== "pending_upload") {
    return { status: 409, message: "This session already has a stored sequence." };
  }
  if ((input.contentType ?? "").startsWith("video/")) {
    return { status: 415, message: "Only landmark sequences are accepted." };
  }
  if (input.byteLength === 0) return { status: 400, message: "The sequence payload was empty." };
  if (input.byteLength > MAX_SEQUENCE_BYTES) {
    return { status: 413, message: "The sequence payload is too large." };
  }
  return null;
}

function wasParsedElsewhere(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body === "object") return Object.keys(body as object).length > 0;
  return true;
}

export function registerSequenceUploadRoute(app: Express) {
  app.post(
    "/api/sessions/:sessionId/sequence",
    express.raw({ type: ["application/gzip", "application/json"], limit: MAX_SEQUENCE_BYTES }),
    async (req, res) => {
      const token = extractBearerToken(req.headers.authorization);
      const signer = token ? await getSignerFromSessionToken(token) : null;
      const session = signer ? await getCaptureSession(req.params.sessionId) : null;
      // Express leaves req.body as {} for a content type this route's raw
      // parser does not handle, which is normal. A *populated* non-Buffer body
      // means another parser consumed the stream first - reporting "empty"
      // there would send someone hunting a client bug that does not exist.
      if (!Buffer.isBuffer(req.body) && wasParsedElsewhere(req.body)) {
        res.status(500).json({
          error: "The sequence route received a parsed body. Register it before express.json().",
        });
        return;
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      const rejection = resolveUploadRejection({
        signer,
        session,
        byteLength: body.byteLength,
        contentType: req.headers["content-type"],
      });
      if (rejection) {
        res.status(rejection.status).json({ error: rejection.message });
        return;
      }

      try {
        await requireCurrentConsent(signer!.id);
      } catch {
        res.status(403).json({ error: "Research consent is required before capture." });
        return;
      }

      let payload: LandmarkSequencePayload;
      try {
        const isGzip = (req.headers["content-type"] ?? "").startsWith("application/gzip");
        const json = isGzip ? gunzipSync(body) : body;
        payload = JSON.parse(json.toString("utf8")) as LandmarkSequencePayload;
      } catch {
        res.status(400).json({ error: "The sequence payload could not be decoded." });
        return;
      }

      if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
        res.status(400).json({ error: "The sequence contained no frames." });
        return;
      }

      const baseline = computeSignerBaseline(payload.frames);
      const detections = baseline ? detectNmms(payload.frames, { baseline }) : [];

      const key = sequenceObjectKey({ signerId: signer!.id, sessionId: session!.id });
      const stored = await putLandmarkSequence({ key, data: body });

      await storeSequenceForSession({
        sessionId: session!.id,
        payload,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        detections,
      });

      res.status(201).json({
        sessionId: session!.id,
        status: "stored",
        frameCount: payload.frameCount,
        nmmTags: detections.length,
      });
    },
  );
}
