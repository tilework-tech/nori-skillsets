import { readFileSync, existsSync } from "fs";

import { signInWithEmailAndPassword } from "firebase/auth";

import { exchangeRefreshToken } from "@/api/refreshToken.js";
import { getConfigPath } from "@/cli/config.js";
import { getFirebase, configureFirebase } from "@/providers/firebase.js";
import { formatNetworkError } from "@/utils/fetch.js";
import { normalizeUrl } from "@/utils/url.js";

export type NoriConfig = {
  username?: string | null;
  password?: string | null;
  refreshToken?: string | null;
  organizationUrl?: string | null;
};

export class ConfigManager {
  static loadConfig = (): NoriConfig | null => {
    const configPath = getConfigPath();

    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf8");

      // RACE CONDITION HANDLING:
      // During fresh installation, trackEvent() is called fire-and-forget (not awaited)
      // while config file creation happens immediately after. This creates a race where:
      // 1. trackEvent() -> analyticsApi.trackEvent() -> apiRequest() -> loadConfig()
      // 2. The config file might not exist yet, or exist but be empty/incomplete
      // 3. Calling JSON.parse('') throws "Unexpected end of JSON input"
      //
      // By checking for empty/whitespace before JSON.parse(), we:
      // - Avoid the error message that confuses users during fresh installs
      // - Return {} gracefully (same as if file doesn't exist)
      // - Still catch truly unexpected errors (malformed JSON, filesystem issues)
      //
      // This is an EXPECTED race condition by design (analytics shouldn't block install)
      const trimmedContent = content.trim();
      if (trimmedContent === "") {
        return {};
      }

      try {
        const parsed = JSON.parse(trimmedContent);

        // Handle both nested auth format (v19+) and legacy flat format
        // Nested format: { auth: { username, password, refreshToken, organizationUrl } }
        // Flat format: { username, password, refreshToken, organizationUrl }
        if (parsed.auth != null && typeof parsed.auth === "object") {
          // Extract auth fields from nested format to root level
          return {
            username: parsed.auth.username ?? null,
            password: parsed.auth.password ?? null,
            refreshToken: parsed.auth.refreshToken ?? null,
            organizationUrl: parsed.auth.organizationUrl ?? null,
          };
        }

        // Legacy flat format - return as-is
        return parsed;
      } catch {
        return null;
      }
    }

    return null;
  };

  static isConfigured = (): boolean => {
    const config = ConfigManager.loadConfig();
    // Support both token-based auth (refreshToken) and legacy password-based auth
    const hasAuth = !!(config?.refreshToken || config?.password);
    return !!(config?.username && hasAuth && config?.organizationUrl);
  };
}

class AuthManager {
  private static authToken?: string | null;
  private static tokenExpiry?: number | null;

  static async getAuthToken(
    args: { forceRefresh?: boolean | null } = {},
  ): Promise<string> {
    const { forceRefresh } = args;

    // Check if token exists and is still valid
    if (!forceRefresh && AuthManager.authToken && AuthManager.tokenExpiry) {
      if (Date.now() < AuthManager.tokenExpiry) {
        return AuthManager.authToken;
      }
    }

    const config = ConfigManager.loadConfig();

    if (config == null || !config.organizationUrl || !config.username) {
      throw new Error(
        "Nori is not configured. Please set username and organizationUrl in .nori-config.json in your installation directory",
      );
    }

    // Prefer refresh token-based auth (more secure, no password stored)
    if (config.refreshToken) {
      const result = await exchangeRefreshToken({
        refreshToken: config.refreshToken,
      });
      AuthManager.authToken = result.idToken;
      // Set token expiry to 55 minutes from now (Firebase tokens last 1 hour, refresh before expiry)
      AuthManager.tokenExpiry = Date.now() + 55 * 60 * 1000;
      return AuthManager.authToken;
    }

    // Fall back to legacy password-based auth
    if (!config.password) {
      throw new Error(
        "Nori is not configured. Please set refreshToken or password in .nori-config.json in your installation directory",
      );
    }

    // Initialize Firebase if not already done
    configureFirebase();

    // Sign in with Firebase Auth
    const userCredential = await signInWithEmailAndPassword(
      getFirebase().auth,
      config.username,
      config.password,
    );

    // Get the ID token
    AuthManager.authToken = await userCredential.user.getIdToken();

    // Set token expiry to 55 minutes from now (Firebase tokens last 1 hour, refresh before expiry)
    AuthManager.tokenExpiry = Date.now() + 55 * 60 * 1000;

    return AuthManager.authToken;
  }

  static clearAuth = (): void => {
    AuthManager.authToken = null;
    AuthManager.tokenExpiry = null;
  };
}

export const apiRequest = async <T>(args: {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  queryParams?: Record<string, string>;
  retries?: number | null;
  baseUrl?: string | null;
}): Promise<T> => {
  const {
    path,
    method = "GET",
    body,
    queryParams,
    retries = 3,
    baseUrl,
  } = args;

  const config = ConfigManager.loadConfig();

  // Use provided baseUrl, or fall back to config.organizationUrl
  const effectiveBaseUrl = baseUrl ?? config?.organizationUrl;

  if (effectiveBaseUrl == null) {
    throw new Error("Organization URL not configured");
  }

  // Build URL with query params (normalize to prevent double slashes)
  let url = normalizeUrl({
    baseUrl: effectiveBaseUrl,
    path: `/api${path}`,
  });
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url += `?${params.toString()}`;
  }

  // Get auth token
  const token = await AuthManager.getAuthToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  let lastError: Error | null = null;
  const maxRetries = retries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        // If unauthorized, try to refresh token and retry
        if (response.status === 401 && attempt < maxRetries) {
          await AuthManager.getAuthToken({ forceRefresh: true });
          continue;
        }

        const errorData = (await response.json().catch(() => ({
          error: `HTTP ${response.status}: ${response.statusText}`,
        }))) as { error?: string };

        throw new Error(errorData.error || "API request failed");
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error as Error;

      // Don't retry on network errors - they're likely permanent (proxy/DNS issues)
      const errorCode = (error as NodeJS.ErrnoException)?.code;
      const isNetworkErr =
        errorCode === "ECONNREFUSED" ||
        errorCode === "ENOTFOUND" ||
        errorCode === "ETIMEDOUT" ||
        errorCode === "ECONNRESET";

      if (isNetworkErr) {
        const networkError = formatNetworkError({ error: error as Error, url });
        throw networkError;
      }

      // Retry on other errors
      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw lastError || new Error("API request failed after retries");
};
