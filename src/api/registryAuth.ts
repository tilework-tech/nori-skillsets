/**
 * Registry authentication module
 * Uses the same refresh token as Watchtower (unified Nori auth), or a raw API token
 * for private-org programmatic access.
 */

import { readApiTokenEnv } from "@/api/base.js";
import { exchangeRefreshToken } from "@/api/refreshToken.js";
import { extractOrgId } from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";

// Cache for auth tokens per registry URL (Firebase ID tokens only)
const tokenCache = new Map<string, { token: string; expiry: number }>();

/**
 * Get auth token for a registry.
 * Precedence: NORI_API_TOKEN env var (scoped match) > config apiToken (scoped match)
 * > refreshToken exchange. API tokens are returned raw and NOT cached.
 *
 * @param args - The authentication parameters
 * @param args.registryAuth - Registry authentication credentials
 *
 * @returns The token to use as `Authorization: Bearer <token>`
 */
export const getRegistryAuthToken = async (args: {
  registryAuth: RegistryAuth;
}): Promise<string> => {
  const { registryAuth } = args;
  const cacheKey = registryAuth.registryUrl;
  const targetOrgId = extractOrgId({ url: registryAuth.registryUrl });

  // Env-var API token (scoped match) — highest precedence, no caching.
  // Uses the shared reader so partial-pair warning semantics match AuthManager.
  const envApi = readApiTokenEnv();
  if (envApi != null && targetOrgId != null && envApi.orgId === targetOrgId) {
    return envApi.token;
  }

  // Config API token (scoped match) — no caching
  if (
    registryAuth.apiToken != null &&
    registryAuth.apiTokenOrgId != null &&
    targetOrgId != null &&
    registryAuth.apiTokenOrgId === targetOrgId
  ) {
    return registryAuth.apiToken;
  }

  // Check token cache (Firebase ID tokens only)
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  if (registryAuth.refreshToken == null) {
    throw new Error(
      "No refresh token available. Please log in with 'nori-skillsets login'.",
    );
  }

  const result = await exchangeRefreshToken({
    refreshToken: registryAuth.refreshToken,
  });

  // Cache with 55 minute expiry (Firebase tokens last 1 hour)
  tokenCache.set(cacheKey, {
    token: result.idToken,
    expiry: Date.now() + 55 * 60 * 1000,
  });

  return result.idToken;
};

/**
 * Clear the registry auth cache
 * Useful for testing
 */
export const clearRegistryAuthCache = (): void => {
  tokenCache.clear();
};
