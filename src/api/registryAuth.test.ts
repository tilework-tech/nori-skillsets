/**
 * Tests for registry authentication module
 */
import { signInWithEmailAndPassword } from "firebase/auth";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { RegistryAuth } from "@/installer/config.js";

import {
  getRegistryAuthToken,
  clearRegistryAuthCache,
} from "./registryAuth.js";

// Mock Firebase - must be after imports for vitest hoisting
vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({ name: "mock-app" })),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({ name: "mock-auth" })),
  signInWithEmailAndPassword: vi.fn(),
}));

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
    it("should sign in with Firebase and return ID token", async () => {
      const mockIdToken = "mock-firebase-id-token";
      const mockUserCredential = {
        user: {
          getIdToken: vi.fn().mockResolvedValue(mockIdToken),
        },
      };

      vi.mocked(signInWithEmailAndPassword).mockResolvedValue(
        mockUserCredential as any,
      );

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        password: "testpassword",
        registryUrl: "https://registrar.tilework.tech",
      };

      const token = await getRegistryAuthToken({ registryAuth });

      expect(token).toBe(mockIdToken);
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
        expect.anything(),
        "test@example.com",
        "testpassword",
      );
    });

    it("should cache token and return cached value on subsequent calls", async () => {
      const mockIdToken = "mock-firebase-id-token";
      const mockUserCredential = {
        user: {
          getIdToken: vi.fn().mockResolvedValue(mockIdToken),
        },
      };

      vi.mocked(signInWithEmailAndPassword).mockResolvedValue(
        mockUserCredential as any,
      );

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        password: "testpassword",
        registryUrl: "https://registrar.tilework.tech",
      };

      // First call
      const token1 = await getRegistryAuthToken({ registryAuth });
      // Second call
      const token2 = await getRegistryAuthToken({ registryAuth });

      expect(token1).toBe(mockIdToken);
      expect(token2).toBe(mockIdToken);

      // Should only sign in once due to caching
      expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
    });

    it("should use different cache entries for different registries", async () => {
      const mockIdToken1 = "mock-token-1";
      const mockIdToken2 = "mock-token-2";

      vi.mocked(signInWithEmailAndPassword)
        .mockResolvedValueOnce({
          user: { getIdToken: vi.fn().mockResolvedValue(mockIdToken1) },
        } as any)
        .mockResolvedValueOnce({
          user: { getIdToken: vi.fn().mockResolvedValue(mockIdToken2) },
        } as any);

      const registryAuth1: RegistryAuth = {
        username: "user1@example.com",
        password: "pass1",
        registryUrl: "https://registry1.example.com",
      };

      const registryAuth2: RegistryAuth = {
        username: "user2@example.com",
        password: "pass2",
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

      // Should sign in twice (once per registry)
      expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(2);
    });

    it("should throw error on invalid credentials", async () => {
      vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
        new Error("auth/wrong-password"),
      );

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        password: "wrongpassword",
        registryUrl: "https://registrar.tilework.tech",
      };

      await expect(getRegistryAuthToken({ registryAuth })).rejects.toThrow(
        "auth/wrong-password",
      );
    });

    it("should throw error on network failure", async () => {
      vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
        new Error("Network error"),
      );

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        password: "testpassword",
        registryUrl: "https://registrar.tilework.tech",
      };

      await expect(getRegistryAuthToken({ registryAuth })).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("clearRegistryAuthCache", () => {
    it("should clear cached tokens", async () => {
      const mockIdToken = "mock-firebase-id-token";
      const mockUserCredential = {
        user: {
          getIdToken: vi.fn().mockResolvedValue(mockIdToken),
        },
      };

      vi.mocked(signInWithEmailAndPassword).mockResolvedValue(
        mockUserCredential as any,
      );

      const registryAuth: RegistryAuth = {
        username: "test@example.com",
        password: "testpassword",
        registryUrl: "https://registrar.tilework.tech",
      };

      // First call
      await getRegistryAuthToken({ registryAuth });

      // Clear cache
      clearRegistryAuthCache();

      // Second call should sign in again
      await getRegistryAuthToken({ registryAuth });

      expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(2);
    });
  });
});
