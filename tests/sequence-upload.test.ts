import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { MAX_SEQUENCE_BYTES, resolveUploadRejection } from "../server/sequence-upload";
import { sequenceObjectKey } from "../server/sequence-storage";
import { promptOrderForSigner } from "../server/session-service";
import { CORPUS_CATEGORIES, CORPUS_SIZE } from "../shared/corpus";
import { corpusSeed } from "../server/corpus-seed";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const signer = { id: 7 };
const session = { id: "s-1", signerId: 7, status: "recording" };

describe("sequence object keys", () => {
  it("namespaces by signer and session and never uses a video extension", () => {
    const key = sequenceObjectKey({ signerId: 7, sessionId: "s-1" });
    expect(key).toBe("sequences/signer-7/s-1.json.gz");
    expect(key).not.toMatch(/\.mp4$/);
  });
});

describe("upload authorization", () => {
  it("rejects an unauthenticated upload", () => {
    expect(
      resolveUploadRejection({
        signer: null,
        session,
        byteLength: 100,
        contentType: "application/json",
      }),
    ).toEqual({ status: 401, message: "Sign in before submitting a sequence." });
  });

  it("rejects a session that belongs to another signer", () => {
    expect(
      resolveUploadRejection({
        signer,
        session: { ...session, signerId: 99 },
        byteLength: 100,
        contentType: "application/json",
      }),
    ).toEqual({ status: 403, message: "This session belongs to another signer." });
  });

  it("rejects a missing session", () => {
    expect(
      resolveUploadRejection({
        signer,
        session: null,
        byteLength: 100,
        contentType: "application/json",
      }),
    ).toEqual({ status: 404, message: "The capture session was not found." });
  });

  it("rejects a session that already has a stored sequence", () => {
    expect(
      resolveUploadRejection({
        signer,
        session: { ...session, status: "stored" },
        byteLength: 100,
        contentType: "application/json",
      }),
    ).toEqual({ status: 409, message: "This session already has a stored sequence." });
  });

  it("rejects an empty body", () => {
    expect(
      resolveUploadRejection({ signer, session, byteLength: 0, contentType: "application/json" }),
    ).toEqual({ status: 400, message: "The sequence payload was empty." });
  });

  it("rejects a body over the size limit", () => {
    expect(
      resolveUploadRejection({
        signer,
        session,
        byteLength: MAX_SEQUENCE_BYTES + 1,
        contentType: "application/json",
      }),
    ).toEqual({ status: 413, message: "The sequence payload is too large." });
  });

  it("rejects a video content type outright", () => {
    expect(
      resolveUploadRejection({ signer, session, byteLength: 100, contentType: "video/mp4" }),
    ).toEqual({ status: 415, message: "Only landmark sequences are accepted." });
  });

  it("accepts a signer's own recording session", () => {
    expect(
      resolveUploadRejection({ signer, session, byteLength: 4096, contentType: "application/json" }),
    ).toBeNull();
  });
});

describe("prompt ordering", () => {
  it("covers the whole corpus exactly once", () => {
    const order = promptOrderForSigner(1);
    expect(order).toHaveLength(CORPUS_SIZE);
    expect(new Set(order).size).toBe(CORPUS_SIZE);
  });

  it("is stable for a given signer", () => {
    expect(promptOrderForSigner(3)).toEqual(promptOrderForSigner(3));
  });

  it("keeps a partial contribution balanced across categories", () => {
    const byId = new Map(corpusSeed.map((p) => [p.id, p.category]));
    const firstTen = promptOrderForSigner(1).slice(0, 10).map((id) => byId.get(id)!);
    for (const category of CORPUS_CATEGORIES) {
      expect(firstTen.filter((c) => c === category)).toHaveLength(2);
    }
  });

  it("varies the starting category between signers", () => {
    const byId = new Map(corpusSeed.map((p) => [p.id, p.category]));
    const starts = new Set([1, 2, 3, 4, 5].map((id) => byId.get(promptOrderForSigner(id)[0])!));
    expect(starts.size).toBeGreaterThan(1);
  });
});

describe("capture router authorization", () => {
  it("refuses to start a session without a signer", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.capture.startSession({ promptId: "A-01" })).rejects.toThrow(/sign in/i);
  });

  it("refuses to report progress without a signer", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.capture.progress()).rejects.toThrow(/sign in/i);
  });

  it("refuses to serve the next prompt without a signer", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.capture.nextPrompt()).rejects.toThrow(/sign in/i);
  });

  it("refuses to skip a prompt without a signer", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.capture.skipPrompt({ promptId: "A-01", reason: "too dark" }),
    ).rejects.toThrow(/sign in/i);
  });
});
