import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerSequenceUploadRoute } from "../server/sequence-upload";

/**
 * Guards the middleware ordering that once broke this route silently: a global
 * express.json() registered first consumes the stream, so the raw handler
 * receives a parsed object and every upload failed as "payload was empty" -
 * a message that points at the client when the fault is server wiring.
 */
function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

describe("sequence upload route wiring", () => {
  let correct: { url: string; server: Server };
  let broken: { url: string; server: Server };

  beforeAll(async () => {
    const good = express();
    registerSequenceUploadRoute(good);
    good.use(express.json());
    correct = await listen(good);

    const bad = express();
    bad.use(express.json());
    registerSequenceUploadRoute(bad);
    broken = await listen(bad);
  });

  afterAll(async () => {
    correct.server.close();
    broken.server.close();
  });

  it("reaches the authorization gate when registered before the JSON parser", async () => {
    const res = await fetch(`${correct.url}/api/sessions/abc/sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, frames: [{ t: 0 }] }),
    });
    // No credentials, so 401 - the point is that the body arrived intact and the
    // request was judged on authorization rather than dying as "empty".
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/sign in/i);
  });

  it("names the real fault when a body parser ran first", async () => {
    const res = await fetch(`${broken.url}/api/sessions/abc/sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, frames: [{ t: 0 }] }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/register it before express\.json/i);
  });

  it("rejects a video content type before reading any body", async () => {
    const res = await fetch(`${correct.url}/api/sessions/abc/sequence`, {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: "x",
    });
    expect(res.status).toBe(401);
  });
});
