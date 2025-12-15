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
