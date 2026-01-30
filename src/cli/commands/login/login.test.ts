/**
 * Tests for the login command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getConfigPath, loadConfig } from "@/cli/config.js";

import { loginMain } from "./login.js";

// Mock Firebase SDK
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: vi.fn(),
  AuthErrorCodes: {
    INVALID_PASSWORD: "auth/wrong-password",
    INVALID_LOGIN_CREDENTIALS: "auth/invalid-login-credentials",
    USER_DELETED: "auth/user-not-found",
    TOO_MANY_ATTEMPTS_TRY_LATER: "auth/too-many-requests",
    NETWORK_REQUEST_FAILED: "auth/network-request-failed",
  },
}));

// Mock Firebase provider
vi.mock("@/providers/firebase.js", () => ({
  configureFirebase: vi.fn(),
  getFirebase: vi.fn().mockReturnValue({
    auth: {},
    app: { options: { projectId: "test-project" } },
  }),
}));

// Mock prompt
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
}));

// Mock logger to suppress output during tests
vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
}));

// Mock fetch for check-access endpoint
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("login command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "login-test-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loginMain", () => {
    it("should authenticate with Firebase and save credentials to config", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");

      // Mock user prompts
      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com") // email
        .mockResolvedValueOnce("password123"); // password

      // Mock Firebase sign in
      vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
        user: {
          refreshToken: "mock-refresh-token",
          getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
        },
      } as any);

      // Mock check-access endpoint
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authorized: true,
            organizations: ["acme", "orderco"],
            isAdmin: true,
          }),
      });

      await loginMain({ installDir: tempDir });

      // Verify config was saved correctly
      const config = await loadConfig({ installDir: tempDir });
      expect(config).not.toBeNull();
      expect(config?.auth?.username).toBe("user@example.com");
      expect(config?.auth?.refreshToken).toBe("mock-refresh-token");
      expect(config?.auth?.organizationUrl).toBe("https://noriskillsets.dev");
      expect(config?.auth?.organizations).toEqual(["acme", "orderco"]);
      expect(config?.auth?.isAdmin).toBe(true);
    });

    it("should use provided email and password in non-interactive mode", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");

      // Mock Firebase sign in
      vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
        user: {
          refreshToken: "mock-refresh-token",
          getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
        },
      } as any);

      // Mock check-access endpoint
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authorized: true,
            organizations: ["myorg"],
            isAdmin: false,
          }),
      });

      await loginMain({
        installDir: tempDir,
        nonInteractive: true,
        email: "test@example.com",
        password: "testpass",
      });

      // Verify Firebase was called with correct credentials
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
        expect.anything(),
        "test@example.com",
        "testpass",
      );

      // Verify config was saved
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.auth?.username).toBe("test@example.com");
    });

    it("should show error for invalid credentials", async () => {
      const { signInWithEmailAndPassword, AuthErrorCodes } =
        await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");
      const { error } = await import("@/cli/logger.js");

      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com")
        .mockResolvedValueOnce("wrongpassword");

      // Mock Firebase to throw invalid credentials error
      const authError = new Error("Invalid credentials");
      (authError as any).code = AuthErrorCodes.INVALID_LOGIN_CREDENTIALS;
      vi.mocked(signInWithEmailAndPassword).mockRejectedValue(authError);

      await loginMain({ installDir: tempDir });

      // Verify error message was shown
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Authentication failed"),
        }),
      );

      // Verify no config was saved
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.auth).toBeUndefined();
    });

    it("should preserve existing config fields when logging in", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");

      // Create existing config with agents and settings
      const existingConfigPath = getConfigPath({ installDir: tempDir });
      await fs.writeFile(
        existingConfigPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          autoupdate: "enabled",
          installDir: tempDir,
        }),
      );

      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com")
        .mockResolvedValueOnce("password123");

      vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
        user: {
          refreshToken: "mock-refresh-token",
          getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
        },
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authorized: true,
            organizations: [],
            isAdmin: false,
          }),
      });

      await loginMain({ installDir: tempDir });

      // Verify existing fields are preserved
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(config?.autoupdate).toBe("enabled");
      // And new auth was added
      expect(config?.auth?.username).toBe("user@example.com");
    });

    it("should save auth with empty organizations if check-access fails", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");
      const { warn } = await import("@/cli/logger.js");

      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com")
        .mockResolvedValueOnce("password123");

      vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
        user: {
          refreshToken: "mock-refresh-token",
          getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
        },
      } as any);

      // Mock check-access to fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal server error" }),
      });

      await loginMain({ installDir: tempDir });

      // Verify warning was shown
      expect(warn).toHaveBeenCalled();

      // Verify auth was saved with empty organizations
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.auth?.username).toBe("user@example.com");
      expect(config?.auth?.refreshToken).toBe("mock-refresh-token");
      expect(config?.auth?.organizations).toEqual([]);
    });

    it("should handle network failure during check-access gracefully", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");
      const { warn } = await import("@/cli/logger.js");

      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com")
        .mockResolvedValueOnce("password123");

      vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
        user: {
          refreshToken: "mock-refresh-token",
          getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
        },
      } as any);

      // Mock fetch to throw network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      await loginMain({ installDir: tempDir });

      // Verify warning was shown
      expect(warn).toHaveBeenCalled();

      // Verify auth was saved with empty organizations
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.auth?.username).toBe("user@example.com");
      expect(config?.auth?.organizations).toEqual([]);
    });

    it("should require email and password in non-interactive mode", async () => {
      const { error } = await import("@/cli/logger.js");

      await loginMain({
        installDir: tempDir,
        nonInteractive: true,
        // Missing email and password
      });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("--email"),
        }),
      );
    });
  });
});
