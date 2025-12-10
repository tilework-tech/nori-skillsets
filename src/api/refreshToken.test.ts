/**
 * Tests for refresh token exchange functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  exchangeRefreshToken,
  clearRefreshTokenCache,
} from "./refreshToken.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("refreshToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRefreshTokenCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearRefreshTokenCache();
  });

  describe("exchangeRefreshToken", () => {
    it("should exchange a valid refresh token for an ID token", async () => {
      const mockResponse = {
        id_token: "new-id-token-123",
        refresh_token: "new-refresh-token-456",
        expires_in: "3600",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await exchangeRefreshToken({
        refreshToken: "valid-refresh-token",
      });

      expect(result.idToken).toBe("new-id-token-123");
      expect(result.refreshToken).toBe("new-refresh-token-456");
      expect(result.expiresIn).toBe(3600);

      // Verify the correct Firebase REST API endpoint was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("securetoken.googleapis.com/v1/token");
      expect(options.method).toBe("POST");
      expect(options.body).toContain("grant_type=refresh_token");
      expect(options.body).toContain("refresh_token=valid-refresh-token");
    });

    it("should throw an error for an expired or invalid refresh token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: 400,
              message: "TOKEN_EXPIRED",
            },
          }),
      });

      await expect(
        exchangeRefreshToken({ refreshToken: "expired-token" }),
      ).rejects.toThrow("TOKEN_EXPIRED");
    });

    it("should throw an error for a revoked refresh token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: 400,
              message: "USER_DISABLED",
            },
          }),
      });

      await expect(
        exchangeRefreshToken({ refreshToken: "revoked-token" }),
      ).rejects.toThrow("USER_DISABLED");
    });

    it("should throw an error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        exchangeRefreshToken({ refreshToken: "valid-token" }),
      ).rejects.toThrow("Network error");
    });

    it("should cache the ID token and return cached value on subsequent calls", async () => {
      const mockResponse = {
        id_token: "cached-id-token",
        refresh_token: "cached-refresh-token",
        expires_in: "3600",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // First call
      const result1 = await exchangeRefreshToken({
        refreshToken: "test-refresh-token",
      });

      // Second call - should use cache
      const result2 = await exchangeRefreshToken({
        refreshToken: "test-refresh-token",
      });

      expect(result1.idToken).toBe("cached-id-token");
      expect(result2.idToken).toBe("cached-id-token");

      // Should only call fetch once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should refresh token when cache expires", async () => {
      const mockResponse1 = {
        id_token: "first-id-token",
        refresh_token: "first-refresh-token",
        expires_in: "1", // 1 second expiry for testing
      };

      const mockResponse2 = {
        id_token: "second-id-token",
        refresh_token: "second-refresh-token",
        expires_in: "3600",
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse1),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse2),
        });

      // First call
      const result1 = await exchangeRefreshToken({
        refreshToken: "test-refresh-token",
      });
      expect(result1.idToken).toBe("first-id-token");

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Second call - should fetch new token
      const result2 = await exchangeRefreshToken({
        refreshToken: "test-refresh-token",
      });
      expect(result2.idToken).toBe("second-id-token");

      // Should call fetch twice
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("clearRefreshTokenCache", () => {
    it("should clear cached tokens", async () => {
      const mockResponse = {
        id_token: "test-id-token",
        refresh_token: "test-refresh-token",
        expires_in: "3600",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // First call
      await exchangeRefreshToken({ refreshToken: "test-token" });

      // Clear cache
      clearRefreshTokenCache();

      // Second call - should fetch again
      await exchangeRefreshToken({ refreshToken: "test-token" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
