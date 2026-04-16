/**
 * Tests for API token parsing/validation utilities.
 */

import { describe, it, expect } from "vitest";

import { extractOrgIdFromApiToken, isValidApiToken } from "./apiToken.js";

describe("isValidApiToken", () => {
  it("should accept a well-formed token with a simple orgId", () => {
    expect(isValidApiToken({ token: `nori_acme_${"a".repeat(64)}` })).toBe(
      true,
    );
  });

  it("should accept a token with a hyphenated orgId", () => {
    expect(
      isValidApiToken({ token: `nori_my-company_${"a".repeat(64)}` }),
    ).toBe(true);
  });

  it("should reject a token with no org segment", () => {
    expect(isValidApiToken({ token: `nori_${"a".repeat(64)}` })).toBe(false);
  });

  it("should reject a token with an uppercase orgId", () => {
    expect(isValidApiToken({ token: `nori_Acme_${"a".repeat(64)}` })).toBe(
      false,
    );
  });

  it("should reject a token with the wrong hex length", () => {
    expect(isValidApiToken({ token: `nori_acme_${"a".repeat(63)}` })).toBe(
      false,
    );
    expect(isValidApiToken({ token: `nori_acme_${"a".repeat(65)}` })).toBe(
      false,
    );
  });

  it("should reject a token without the nori_ prefix", () => {
    expect(isValidApiToken({ token: `acme_${"a".repeat(64)}` })).toBe(false);
  });

  it("should reject a garbage string", () => {
    expect(isValidApiToken({ token: "not-a-token" })).toBe(false);
    expect(isValidApiToken({ token: "" })).toBe(false);
  });
});

describe("extractOrgIdFromApiToken", () => {
  it("should extract the orgId from a valid token", () => {
    expect(
      extractOrgIdFromApiToken({ token: `nori_acme_${"a".repeat(64)}` }),
    ).toBe("acme");
  });

  it("should extract a hyphenated orgId", () => {
    expect(
      extractOrgIdFromApiToken({ token: `nori_my-company_${"a".repeat(64)}` }),
    ).toBe("my-company");
  });

  it("should return null for a malformed token", () => {
    expect(extractOrgIdFromApiToken({ token: "not-a-token" })).toBeNull();
    expect(
      extractOrgIdFromApiToken({ token: `nori_${"a".repeat(64)}` }),
    ).toBeNull();
  });
});
