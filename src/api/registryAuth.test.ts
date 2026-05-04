/**
 * Tests for registry authentication module
 * Now uses refresh token exchange instead of email/password sign-in
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the refresh token module
vi.mock("@/api/refreshToken.js", () => ({
  exchangeRefreshToken: vi.fn(),
}));

import { exchangeRefreshToken } from "@/api/refreshToken.js";

import type { RegistryAuth } from "@/cli/config.js";

import {
  getRegistryAuthToken,
  clearRegistryAuthCache,
} from "./registryAuth.js";

describe("registryAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistryAuthCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearRegistryAuthCache();
  });

  describe("getRegistryAuthToken", () => {
    it("should exchange refresh token and return ID token", async () => {
      const mockIdToken = "mock-firebase-id-token";

      vi.mocked(exchangeRefreshToken).mockResolvedValue({
        idToken: mockIdToken,
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
      });

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        refreshToken: "test-refresh-token",
        registryUrl: "https://noriskillsets.dev",
      };

      const token = await getRegistryAuthToken({ registryAuth });

      expect(token).toBe(mockIdToken);
      expect(exchangeRefreshToken).toHaveBeenCalledWith({
        refreshToken: "test-refresh-token",
      });
    });

    it("should cache token and return cached value on subsequent calls", async () => {
      const mockIdToken = "mock-firebase-id-token";

      vi.mocked(exchangeRefreshToken).mockResolvedValue({
        idToken: mockIdToken,
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
      });

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        refreshToken: "test-refresh-token",
        registryUrl: "https://noriskillsets.dev",
      };

      // First call
      const token1 = await getRegistryAuthToken({ registryAuth });
      // Second call
      const token2 = await getRegistryAuthToken({ registryAuth });

      expect(token1).toBe(mockIdToken);
      expect(token2).toBe(mockIdToken);

      // Should only exchange once due to caching
      expect(exchangeRefreshToken).toHaveBeenCalledTimes(1);
    });

    it("should use different cache entries for different registries", async () => {
      const mockIdToken1 = "mock-token-1";
      const mockIdToken2 = "mock-token-2";

      vi.mocked(exchangeRefreshToken)
        .mockResolvedValueOnce({
          idToken: mockIdToken1,
          refreshToken: "new-refresh-token-1",
          expiresIn: 3600,
        })
        .mockResolvedValueOnce({
          idToken: mockIdToken2,
          refreshToken: "new-refresh-token-2",
          expiresIn: 3600,
        });

      const registryAuth1: RegistryAuth = {
        username: "user1@example.com",
        refreshToken: "refresh-token-1",
        registryUrl: "https://registry1.example.com",
      };

      const registryAuth2: RegistryAuth = {
        username: "user2@example.com",
        refreshToken: "refresh-token-2",
        registryUrl: "https://registry2.example.com",
      };

      const token1 = await getRegistryAuthToken({
        registryAuth: registryAuth1,
      });
      const token2 = await getRegistryAuthToken({
        registryAuth: registryAuth2,
      });

      expect(token1).toBe(mockIdToken1);
      expect(token2).toBe(mockIdToken2);

      // Should exchange twice (once per registry)
      expect(exchangeRefreshToken).toHaveBeenCalledTimes(2);
    });

    it("should throw error when refresh token is missing", async () => {
      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        registryUrl: "https://noriskillsets.dev",
      };

      await expect(getRegistryAuthToken({ registryAuth })).rejects.toThrow(
        "No refresh token available",
      );

      // Should not attempt to exchange
      expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });

    it("should throw error on token exchange failure", async () => {
      vi.mocked(exchangeRefreshToken).mockRejectedValue(
        new Error("TOKEN_EXPIRED"),
      );

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        refreshToken: "expired-refresh-token",
        registryUrl: "https://noriskillsets.dev",
      };

      await expect(getRegistryAuthToken({ registryAuth })).rejects.toThrow(
        "TOKEN_EXPIRED",
      );
    });

    it("should throw error on network failure", async () => {
      vi.mocked(exchangeRefreshToken).mockRejectedValue(
        new Error("Network error"),
      );

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        refreshToken: "test-refresh-token",
        registryUrl: "https://noriskillsets.dev",
      };

      await expect(getRegistryAuthToken({ registryAuth })).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("getRegistryAuthToken with apiToken", () => {
    const origEnvToken = process.env.NORI_API_TOKEN;

    beforeEach(() => {
      delete process.env.NORI_API_TOKEN;
    });

    afterEach(() => {
      if (origEnvToken == null) delete process.env.NORI_API_TOKEN;
      else process.env.NORI_API_TOKEN = origEnvToken;
    });

    it("should return raw apiToken without calling exchangeRefreshToken when token's org matches URL org", async () => {
      const registryAuth: RegistryAuth = {
        username: "n/a",
        registryUrl: "https://acme.noriskillsets.dev",
        apiToken: `nori_acme_${"a".repeat(64)}`,
      };

      const token = await getRegistryAuthToken({ registryAuth });

      expect(token).toBe(`nori_acme_${"a".repeat(64)}`);
      expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });

    it("should NOT cache apiToken responses (next call with rotated token returns new value)", async () => {
      // Since we return the raw token by early-return, no cache entry is created.
      // Validate by switching the apiToken value for a second call and seeing the new value.
      const registryAuth1: RegistryAuth = {
        username: "n/a",
        registryUrl: "https://acme.noriskillsets.dev",
        apiToken: `nori_acme_${"a".repeat(64)}`,
      };
      const registryAuth2: RegistryAuth = {
        username: "n/a",
        registryUrl: "https://acme.noriskillsets.dev",
        apiToken: `nori_acme_${"b".repeat(64)}`,
      };

      const token1 = await getRegistryAuthToken({
        registryAuth: registryAuth1,
      });
      const token2 = await getRegistryAuthToken({
        registryAuth: registryAuth2,
      });

      expect(token1).toBe(`nori_acme_${"a".repeat(64)}`);
      expect(token2).toBe(`nori_acme_${"b".repeat(64)}`);
      expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });

    it("should fall through to refreshToken flow when token's org does not match URL org", async () => {
      const mockIdToken = "mock-firebase-id-token";
      vi.mocked(exchangeRefreshToken).mockResolvedValue({
        idToken: mockIdToken,
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
      });

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        registryUrl: "https://foo.noriskillsets.dev",
        refreshToken: "refresh-xyz",
        apiToken: `nori_acme_${"c".repeat(64)}`,
      };

      const token = await getRegistryAuthToken({ registryAuth });

      expect(token).toBe(mockIdToken);
      expect(exchangeRefreshToken).toHaveBeenCalledWith({
        refreshToken: "refresh-xyz",
      });
    });

    it("should prefer NORI_API_TOKEN env var when env token's org matches URL org", async () => {
      process.env.NORI_API_TOKEN = `nori_acme_${"d".repeat(64)}`;

      const registryAuth: RegistryAuth = {
        username: "n/a",
        registryUrl: "https://acme.noriskillsets.dev",
        apiToken: `nori_acme_${"e".repeat(64)}`,
      };

      const token = await getRegistryAuthToken({ registryAuth });

      expect(token).toBe(`nori_acme_${"d".repeat(64)}`);
      expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });

    it("should prefer NORI_API_TOKEN public token when registry URL is the public apex", async () => {
      process.env.NORI_API_TOKEN = `nori_public_${"f".repeat(64)}`;

      const registryAuth: RegistryAuth = {
        username: "n/a",
        registryUrl: "https://noriskillsets.dev",
        apiToken: `nori_acme_${"e".repeat(64)}`,
      };

      const token = await getRegistryAuthToken({ registryAuth });

      expect(token).toBe(`nori_public_${"f".repeat(64)}`);
      expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe("clearRegistryAuthCache", () => {
    it("should clear cached tokens", async () => {
      const mockIdToken = "mock-firebase-id-token";

      vi.mocked(exchangeRefreshToken).mockResolvedValue({
        idToken: mockIdToken,
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
      });

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        refreshToken: "test-refresh-token",
        registryUrl: "https://noriskillsets.dev",
      };

      // First call
      await getRegistryAuthToken({ registryAuth });

      // Clear cache
      clearRegistryAuthCache();

      // Second call should exchange again
      await getRegistryAuthToken({ registryAuth });

      expect(exchangeRefreshToken).toHaveBeenCalledTimes(2);
    });
  });
});
