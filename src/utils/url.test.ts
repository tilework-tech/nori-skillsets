import { describe, expect, it } from "vitest";

import {
  normalizeUrl,
  isValidOrgId,
  buildWatchtowerUrl,
  buildRegistryUrl,
  buildOrganizationRegistryUrl,
  isValidUrl,
  extractOrgId,
  parseNamespacedPackage,
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

describe("buildOrganizationRegistryUrl", () => {
  it("should return apex domain for public org", () => {
    expect(buildOrganizationRegistryUrl({ orgId: "public" })).toBe(
      "https://noriskillsets.dev",
    );
  });

  it("should return subdomain URL for non-public org", () => {
    expect(buildOrganizationRegistryUrl({ orgId: "myorg" })).toBe(
      "https://myorg.noriskillsets.dev",
    );
  });

  it("should handle org ID with hyphens", () => {
    expect(buildOrganizationRegistryUrl({ orgId: "my-company" })).toBe(
      "https://my-company.noriskillsets.dev",
    );
  });
});

describe("parseNamespacedPackage", () => {
  describe("non-namespaced packages", () => {
    it("should parse simple package name as public", () => {
      const result = parseNamespacedPackage({ packageSpec: "my-profile" });
      expect(result).toEqual({
        orgId: "public",
        packageName: "my-profile",
        version: null,
      });
    });

    it("should parse package with version as public", () => {
      const result = parseNamespacedPackage({
        packageSpec: "my-profile@1.0.0",
      });
      expect(result).toEqual({
        orgId: "public",
        packageName: "my-profile",
        version: "1.0.0",
      });
    });

    it("should parse package with prerelease version", () => {
      const result = parseNamespacedPackage({
        packageSpec: "my-profile@1.0.0-beta.1",
      });
      expect(result).toEqual({
        orgId: "public",
        packageName: "my-profile",
        version: "1.0.0-beta.1",
      });
    });
  });

  describe("namespaced packages", () => {
    it("should parse namespaced package", () => {
      const result = parseNamespacedPackage({
        packageSpec: "myorg/my-profile",
      });
      expect(result).toEqual({
        orgId: "myorg",
        packageName: "my-profile",
        version: null,
      });
    });

    it("should parse namespaced package with version", () => {
      const result = parseNamespacedPackage({
        packageSpec: "myorg/my-profile@2.0.0",
      });
      expect(result).toEqual({
        orgId: "myorg",
        packageName: "my-profile",
        version: "2.0.0",
      });
    });

    it("should handle org ID with hyphens", () => {
      const result = parseNamespacedPackage({
        packageSpec: "my-company/my-profile",
      });
      expect(result).toEqual({
        orgId: "my-company",
        packageName: "my-profile",
        version: null,
      });
    });
  });

  describe("edge cases", () => {
    it("should return null for invalid package spec with multiple slashes", () => {
      const result = parseNamespacedPackage({
        packageSpec: "org/sub/package",
      });
      expect(result).toBe(null);
    });

    it("should return null for empty string", () => {
      const result = parseNamespacedPackage({ packageSpec: "" });
      expect(result).toBe(null);
    });

    it("should return null for invalid org ID format", () => {
      const result = parseNamespacedPackage({
        packageSpec: "MyOrg/my-profile",
      });
      expect(result).toBe(null);
    });
  });
});

describe("extractOrgId", () => {
  describe("watchtower URLs", () => {
    it("should extract org ID from watchtower URL", () => {
      expect(extractOrgId({ url: "https://tilework.tilework.tech" })).toBe(
        "tilework",
      );
    });

    it("should extract org ID with hyphens from watchtower URL", () => {
      expect(extractOrgId({ url: "https://my-company.tilework.tech" })).toBe(
        "my-company",
      );
    });

    it("should handle watchtower URL with path", () => {
      expect(
        extractOrgId({ url: "https://myorg.tilework.tech/api/test" }),
      ).toBe("myorg");
    });
  });

  describe("registry URLs (nori-registry.ai)", () => {
    it("should extract org ID from registry URL", () => {
      expect(extractOrgId({ url: "https://myorg.nori-registry.ai" })).toBe(
        "myorg",
      );
    });

    it("should extract org ID with hyphens from registry URL", () => {
      expect(extractOrgId({ url: "https://my-org.nori-registry.ai" })).toBe(
        "my-org",
      );
    });
  });

  describe("organization registry URLs (noriskillsets.dev)", () => {
    it("should return 'public' for apex domain", () => {
      expect(extractOrgId({ url: "https://noriskillsets.dev" })).toBe("public");
    });

    it("should extract org ID from subdomain", () => {
      expect(extractOrgId({ url: "https://myorg.noriskillsets.dev" })).toBe(
        "myorg",
      );
    });

    it("should extract org ID with hyphens from subdomain", () => {
      expect(
        extractOrgId({ url: "https://my-company.noriskillsets.dev" }),
      ).toBe("my-company");
    });

    it("should handle URL with path", () => {
      expect(
        extractOrgId({ url: "https://myorg.noriskillsets.dev/api/profiles" }),
      ).toBe("myorg");
    });

    it("should handle apex domain with path", () => {
      expect(
        extractOrgId({ url: "https://noriskillsets.dev/api/profiles" }),
      ).toBe("public");
    });
  });

  describe("non-Nori URLs", () => {
    it("should return null for localhost URL", () => {
      expect(extractOrgId({ url: "http://localhost:3000" })).toBe(null);
    });

    it("should return null for generic URL", () => {
      expect(extractOrgId({ url: "https://example.com" })).toBe(null);
    });

    it("should return null for invalid URL", () => {
      expect(extractOrgId({ url: "not-a-url" })).toBe(null);
    });

    it("should return null for empty string", () => {
      expect(extractOrgId({ url: "" })).toBe(null);
    });
  });

  describe("edge cases", () => {
    it("should normalize uppercase hostnames to lowercase (URL spec behavior)", () => {
      // URL hostnames are case-insensitive and normalized to lowercase by the URL parser
      // So "https://MyCompany.tilework.tech" becomes "mycompany.tilework.tech"
      expect(extractOrgId({ url: "https://MyCompany.tilework.tech" })).toBe(
        "mycompany",
      );
    });
  });
});
