import { describe, expect, it } from "vitest";

import {
  extractBearerToken,
  generateOpaqueToken,
  hashOpaqueToken,
  hashSignerPassword,
  normalizeSignerEmail,
  verifySignerPassword,
} from "../server/signer-security";

describe("signer security helpers", () => {
  it("normalizes approved signer email addresses", () => {
    expect(normalizeSignerEmail("  SIGNER@example.com ")).toBe("signer@example.com");
  });

  it("creates opaque, hashable values for invitations and sessions", () => {
    const token = generateOpaqueToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hashOpaqueToken(token)).toHaveLength(64);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it("hashes passwords without retaining the supplied value", async () => {
    const password = "a-correct-horse-battery-staple";
    const hash = await hashSignerPassword(password);
    expect(hash).not.toBe(password);
    await expect(verifySignerPassword(password, hash)).resolves.toBe(true);
    await expect(verifySignerPassword("not-the-password", hash)).resolves.toBe(false);
  });

  it("extracts only bearer-form signer tokens", () => {
    expect(extractBearerToken("Bearer signer-token")).toBe("signer-token");
    expect(extractBearerToken("Basic credentials")).toBeNull();
  });
});
