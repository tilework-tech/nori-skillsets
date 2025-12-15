import { describe, expect, it } from "vitest";

import {
  normalizeUrl,
  isValidOrgId,
  buildWatchtowerUrl,
  buildRegistryUrl,
  isValidUrl,
} from "./url";

describe("normalizeUrl", () => {
  it("should remove trailing slashes from base URL", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com/",
      path: null,
    });

    expect(result).toBe("https://example.com");
  });

  it("should handle multiple trailing slashes", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com///",
      path: null,
    });

    expect(result).toBe("https://example.com");
  });

  it("should join base URL and path correctly", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com/",
      path: "/api/endpoint",
    });

    expect(result).toBe("https://example.com/api/endpoint");
  });

  it("should handle path without leading slash", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com",
      path: "api/endpoint",
    });

    expect(result).toBe("https://example.com/api/endpoint");
  });

  it("should handle base URL without trailing slash and path with leading slash", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com",
      path: "/api/endpoint",
    });

    expect(result).toBe("https://example.com/api/endpoint");
  });

  it("should prevent double slashes", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com/",
      path: "/api/endpoint",
    });

    expect(result).toBe("https://example.com/api/endpoint");
  });

  it("should handle empty path", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com/",
      path: "",
    });

    expect(result).toBe("https://example.com");
  });

  it("should handle localhost URLs", () => {
    const result = normalizeUrl({
      baseUrl: "http://localhost:3000/",
      path: "/api/test",
    });

    expect(result).toBe("http://localhost:3000/api/test");
  });

  it("should handle paths with query params", () => {
    const result = normalizeUrl({
      baseUrl: "https://example.com",
      path: "/api/test?param=value",
    });

    expect(result).toBe("https://example.com/api/test?param=value");
  });
});

describe("isValidOrgId", () => {
  it("should return true for valid lowercase alphanumeric org ID", () => {
    expect(isValidOrgId({ orgId: "mycompany" })).toBe(true);
  });

  it("should return true for org ID with hyphens", () => {
    expect(isValidOrgId({ orgId: "my-company" })).toBe(true);
  });

  it("should return true for org ID with numbers", () => {
    expect(isValidOrgId({ orgId: "company123" })).toBe(true);
  });

  it("should return true for org ID with hyphens and numbers", () => {
    expect(isValidOrgId({ orgId: "my-company-2024" })).toBe(true);
  });

  it("should return false for org ID with uppercase letters", () => {
    expect(isValidOrgId({ orgId: "MyCompany" })).toBe(false);
  });

  it("should return false for org ID with underscores", () => {
    expect(isValidOrgId({ orgId: "my_company" })).toBe(false);
  });

  it("should return false for org ID with spaces", () => {
    expect(isValidOrgId({ orgId: "my company" })).toBe(false);
  });

  it("should return false for org ID with special characters", () => {
    expect(isValidOrgId({ orgId: "my@company" })).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidOrgId({ orgId: "" })).toBe(false);
  });

  it("should return false for org ID starting with hyphen", () => {
    expect(isValidOrgId({ orgId: "-company" })).toBe(false);
  });

  it("should return false for org ID ending with hyphen", () => {
    expect(isValidOrgId({ orgId: "company-" })).toBe(false);
  });

  it("should return true for numeric-only org ID", () => {
    // Numeric-only org IDs are valid per the regex pattern
    expect(isValidOrgId({ orgId: "12345" })).toBe(true);
  });
});

describe("buildWatchtowerUrl", () => {
  it("should construct watchtower URL from org ID", () => {
    const result = buildWatchtowerUrl({ orgId: "tilework" });
    expect(result).toBe("https://tilework.tilework.tech");
  });

  it("should handle org ID with hyphens", () => {
    const result = buildWatchtowerUrl({ orgId: "my-company" });
    expect(result).toBe("https://my-company.tilework.tech");
  });
});

describe("buildRegistryUrl", () => {
  it("should construct registry URL from org ID", () => {
    const result = buildRegistryUrl({ orgId: "myorg" });
    expect(result).toBe("https://myorg.nori-registry.ai");
  });

  it("should handle org ID with hyphens", () => {
    const result = buildRegistryUrl({ orgId: "my-company" });
    expect(result).toBe("https://my-company.nori-registry.ai");
  });
});

describe("isValidUrl", () => {
  it("should return true for valid https URL", () => {
    expect(isValidUrl({ input: "https://example.com" })).toBe(true);
  });

  it("should return true for valid http URL", () => {
    expect(isValidUrl({ input: "http://localhost:3000" })).toBe(true);
  });

  it("should return true for URL with path", () => {
    expect(isValidUrl({ input: "https://example.com/api/test" })).toBe(true);
  });

  it("should return false for plain string", () => {
    expect(isValidUrl({ input: "not-a-url" })).toBe(false);
  });

  it("should return false for org ID", () => {
    expect(isValidUrl({ input: "mycompany" })).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidUrl({ input: "" })).toBe(false);
  });
});
