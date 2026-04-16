/**
 * Parsing and validation for API tokens issued by the nori-registrar admin UI.
 *
 * Token format: `nori_<orgId>_<64 hex chars>`
 * - `orgId` is lowercase alphanumeric with hyphens (same rules as `isValidOrgId`).
 * - The 64-char hex suffix is the random key material.
 *
 * The orgId is embedded directly in the token so the client does not need a
 * separate orgId flag or env var — the scope is self-describing.
 */

/**
 * Regular expression for a valid API token.
 * Group 1: the orgId.
 * Group 2: the 64-char hex key.
 */
export const API_TOKEN_PATTERN =
  /^nori_([a-z0-9]+(?:-[a-z0-9]+)*)_([a-f0-9]{64})$/;

/**
 * Check whether a string is a valid API token.
 *
 * @param args - Validation arguments
 * @param args.token - Candidate token string
 *
 * @returns True if the token matches the `nori_<orgId>_<64hex>` shape.
 */
export const isValidApiToken = (args: { token: string }): boolean => {
  const { token } = args;
  return API_TOKEN_PATTERN.test(token);
};

/**
 * Extract the orgId from a valid API token.
 *
 * @param args - Extraction arguments
 * @param args.token - The raw API token
 *
 * @returns The orgId encoded in the token, or null if the token is malformed.
 */
export const extractOrgIdFromApiToken = (args: {
  token: string;
}): string | null => {
  const { token } = args;
  const match = token.match(API_TOKEN_PATTERN);
  if (match == null) {
    return null;
  }
  return match[1];
};
