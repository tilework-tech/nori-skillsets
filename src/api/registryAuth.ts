/**
 * Registry authentication module
 * Uses the same refresh token as Watchtower (unified Nori auth)
 */

import { exchangeRefreshToken } from "@/api/refreshToken.js";

import type { RegistryAuth } from "@/cli/config.js";

// Cache for auth tokens per registry URL
const tokenCache = new Map<string, { token: string; expiry: number }>();

/**
 * Get auth token for a registry using the unified Nori refresh token
 * @param args - The authentication parameters
 * @param args.registryAuth - Registry authentication credentials (must have refreshToken)
 *
 * @returns The Firebase ID token
 */
export const getRegistryAuthToken = async (args: {
  registryAuth: RegistryAuth;
}): Promise<string> => {
  const { registryAuth } = args;
  const cacheKey = registryAuth.registryUrl;

  // Check token cache
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  if (registryAuth.refreshToken == null) {
    throw new Error(
      "No refresh token available. Please log in with 'nori-ai login'.",
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
