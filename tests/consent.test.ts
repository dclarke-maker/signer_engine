import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import {
  CONSENT_SCOPES,
  CURRENT_CONSENT_VERSION,
  isConsentCurrent,
  parseScopes,
} from "../server/consent-service";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("consent vocabulary", () => {
  it("names the participation and workshop scopes", () => {
    expect(CONSENT_SCOPES).toEqual(["participation", "workshop_calibration"]);
  });

  it("parses a stored scope list and rejects unknown scopes", () => {
    expect(parseScopes('["participation"]')).toEqual(["participation"]);
    expect(parseScopes('["participation","bogus"]')).toEqual(["participation"]);
    expect(parseScopes("not json")).toEqual([]);
    expect(parseScopes('"participation"')).toEqual([]);
  });
});

describe("consent currency", () => {
  const base = {
    consentVersion: CURRENT_CONSENT_VERSION,
    withdrawnAt: null as Date | null,
    scopes: '["participation"]',
  };

  it("accepts a current, unwithdrawn grant", () => {
    expect(isConsentCurrent(base, CURRENT_CONSENT_VERSION)).toBe(true);
  });

  it("rejects a withdrawn grant", () => {
    expect(isConsentCurrent({ ...base, withdrawnAt: new Date() }, CURRENT_CONSENT_VERSION)).toBe(
      false,
    );
  });

  it("rejects a grant made against an earlier consent version", () => {
    expect(isConsentCurrent({ ...base, consentVersion: "v0" }, CURRENT_CONSENT_VERSION)).toBe(false);
  });

  it("rejects a missing grant", () => {
    expect(isConsentCurrent(null, CURRENT_CONSENT_VERSION)).toBe(false);
  });
});

describe("consent router", () => {
  it("refuses to grant consent without a signer session", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.consent.grant({ consentVersion: CURRENT_CONSENT_VERSION, scopes: ["participation"] }),
    ).rejects.toThrow(/sign in/i);
  });

  it("refuses to withdraw consent without a signer session", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.consent.withdraw()).rejects.toThrow(/sign in/i);
  });

  it("reports no consent for an anonymous caller", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.consent.status()).resolves.toEqual({
      granted: false,
      consentVersion: CURRENT_CONSENT_VERSION,
      scopes: [],
    });
  });

  it("rejects a grant with an unknown scope", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      // @ts-expect-error deliberately invalid scope
      caller.consent.grant({ consentVersion: CURRENT_CONSENT_VERSION, scopes: ["everything"] }),
    ).rejects.toThrow();
  });

  it("rejects a grant with no scopes at all", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.consent.grant({ consentVersion: CURRENT_CONSENT_VERSION, scopes: [] }),
    ).rejects.toThrow();
  });
});
