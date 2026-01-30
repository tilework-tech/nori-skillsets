/**
 * URL normalization utilities
 * Handles trailing slashes and path joining to prevent double slashes in URLs
 */

/**
 * Normalize a base URL by removing trailing slashes
 * @param args - Normalization arguments
 * @param args.baseUrl - The base URL to normalize (e.g., "https://example.com/")
 * @param args.path - Optional path to append (e.g., "/api/endpoint")
 *
 * @returns Normalized URL with no double slashes
 *
 * @example
 * normalizeUrl({ baseUrl: "https://example.com/", path: "/api/test" })
 * // Returns: "https://example.com/api/test"
 * @example
 * normalizeUrl({ baseUrl: "https://example.com", path: "api/test" })
 * // Returns: "https://example.com/api/test"
 */
export const normalizeUrl = (args: {
  baseUrl: string;
  path?: string | null;
}): string => {
  const { baseUrl, path } = args;

  // Remove trailing slashes from base URL
  const normalizedBase = baseUrl.replace(/\/+$/, "");

  // If no path provided, return normalized base
  if (!path) {
    return normalizedBase;
  }

  // Ensure path starts with exactly one slash
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
};

/**
 * Validate organization ID format
 * Must be lowercase alphanumeric with hyphens, not starting or ending with hyphen
 * @param args - Validation arguments
 * @param args.orgId - The organization ID to validate
 *
 * @returns True if valid, false otherwise
 *
 * @example
 * isValidOrgId({ orgId: "my-company" }) // Returns: true
 * isValidOrgId({ orgId: "MyCompany" }) // Returns: false (uppercase)
 * isValidOrgId({ orgId: "-company" }) // Returns: false (starts with hyphen)
 */
export const isValidOrgId = (args: { orgId: string }): boolean => {
  const { orgId } = args;

  // Must not be empty
  if (orgId.length === 0) {
    return false;
  }

  // Must match lowercase alphanumeric with hyphens, not starting/ending with hyphen
  const validPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  return validPattern.test(orgId);
};

/**
 * Build Watchtower URL from organization ID
 * @param args - Build arguments
 * @param args.orgId - The organization ID
 *
 * @returns The full Watchtower URL
 *
 * @example
 * buildWatchtowerUrl({ orgId: "tilework" })
 * // Returns: "https://tilework.tilework.tech"
 */
export const buildWatchtowerUrl = (args: { orgId: string }): string => {
  const { orgId } = args;
  return `https://${orgId}.tilework.tech`;
};

/**
 * Build Registry URL from organization ID
 * @param args - Build arguments
 * @param args.orgId - The organization ID
 *
 * @returns The full Registry URL
 *
 * @example
 * buildRegistryUrl({ orgId: "myorg" })
 * // Returns: "https://myorg.nori-registry.ai"
 */
export const buildRegistryUrl = (args: { orgId: string }): string => {
  const { orgId } = args;
  return `https://${orgId}.nori-registry.ai`;
};

/**
 * Build Organization Registry URL from organization ID
 * Uses noriskillsets.dev domain. "public" org maps to apex domain.
 * @param args - Build arguments
 * @param args.orgId - The organization ID ("public" for public registry)
 *
 * @returns The full Registry URL
 *
 * @example
 * buildOrganizationRegistryUrl({ orgId: "public" })
 * // Returns: "https://noriskillsets.dev"
 * @example
 * buildOrganizationRegistryUrl({ orgId: "myorg" })
 * // Returns: "https://myorg.noriskillsets.dev"
 */
export const buildOrganizationRegistryUrl = (args: {
  orgId: string;
}): string => {
  const { orgId } = args;
  if (orgId === "public") {
    return "https://noriskillsets.dev";
  }
  return `https://${orgId}.noriskillsets.dev`;
};

/**
 * Check if a string is a valid URL
 * @param args - Validation arguments
 * @param args.input - The string to check
 *
 * @returns True if valid URL, false otherwise
 *
 * @example
 * isValidUrl({ input: "https://example.com" }) // Returns: true
 * isValidUrl({ input: "not-a-url" }) // Returns: false
 */
export const isValidUrl = (args: { input: string }): boolean => {
  const { input } = args;
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
};

/**
 * Extract organization ID from a Nori service URL
 * Supports both Watchtower (*.tilework.tech) and Registry (*.nori-registry.ai) URLs
 * @param args - Extraction arguments
 * @param args.url - The service URL to extract org ID from
 *
 * @returns The organization ID, or null if not a valid Nori service URL
 *
 * @example
 * extractOrgId({ url: "https://tilework.tilework.tech" })
 * // Returns: "tilework"
 * @example
 * extractOrgId({ url: "https://myorg.nori-registry.ai" })
 * // Returns: "myorg"
 * @example
 * extractOrgId({ url: "http://localhost:3000" })
 * // Returns: null (not a Nori service URL)
 */
export const extractOrgId = (args: { url: string }): string | null => {
  const { url } = args;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Check for Watchtower URL pattern: {orgId}.tilework.tech
    if (hostname.endsWith(".tilework.tech")) {
      const orgId = hostname.replace(".tilework.tech", "");
      return isValidOrgId({ orgId }) ? orgId : null;
    }

    // Check for Registry URL pattern: {orgId}.nori-registry.ai
    if (hostname.endsWith(".nori-registry.ai")) {
      const orgId = hostname.replace(".nori-registry.ai", "");
      return isValidOrgId({ orgId }) ? orgId : null;
    }

    // Check for Organization Registry URL pattern: noriskillsets.dev or {orgId}.noriskillsets.dev
    if (hostname === "noriskillsets.dev") {
      return "public";
    }
    if (hostname.endsWith(".noriskillsets.dev")) {
      const orgId = hostname.replace(".noriskillsets.dev", "");
      return isValidOrgId({ orgId }) ? orgId : null;
    }

    // Not a recognized Nori service URL (e.g., localhost for local dev)
    return null;
  } catch {
    return null;
  }
};

/**
 * Result of parsing a namespaced package specification
 */
export type ParsedNamespacedPackage = {
  orgId: string;
  packageName: string;
  version: string | null;
};

/**
 * Parse a namespaced package specification into org, name, and version
 * Supports formats: "package-name", "package-name@1.0.0", "org/package-name", "org/package-name@1.0.0"
 * Non-namespaced packages are treated as belonging to "public" org
 *
 * @param args - Parsing arguments
 * @param args.packageSpec - The package specification string
 *
 * @returns Parsed package info, or null if invalid format
 *
 * @example
 * parseNamespacedPackage({ packageSpec: "my-profile" })
 * // Returns: { orgId: "public", packageName: "my-profile", version: null }
 * @example
 * parseNamespacedPackage({ packageSpec: "myorg/my-profile@1.0.0" })
 * // Returns: { orgId: "myorg", packageName: "my-profile", version: "1.0.0" }
 */
export const parseNamespacedPackage = (args: {
  packageSpec: string;
}): ParsedNamespacedPackage | null => {
  const { packageSpec } = args;

  if (packageSpec.length === 0) {
    return null;
  }

  // Check for multiple slashes (invalid)
  const slashCount = (packageSpec.match(/\//g) || []).length;
  if (slashCount > 1) {
    return null;
  }

  // Pattern: optional org/ prefix, package name, optional @version
  // org: lowercase alphanumeric with hyphens
  // package: lowercase alphanumeric with hyphens
  // version: semver-like (digits, dots, hyphens, alphanumeric)
  const pattern =
    /^(?:([a-z0-9]+(?:-[a-z0-9]+)*)\/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:@(\d+\.\d+\.\d+.*))?$/;
  const match = packageSpec.match(pattern);

  if (match == null) {
    return null;
  }

  const [, orgId, packageName, version] = match;

  // Validate org ID if present
  if (orgId != null && !isValidOrgId({ orgId })) {
    return null;
  }

  return {
    orgId: orgId ?? "public",
    packageName,
    version: version ?? null,
  };
};
