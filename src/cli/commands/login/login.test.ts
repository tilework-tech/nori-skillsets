/**
 * Tests for the login command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getConfigPath, loadConfig } from "@/cli/config.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { loginMain } from "./login.js";

// Mock Firebase SDK
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: vi.fn(),
  signInWithCredential: vi.fn(),
  GoogleAuthProvider: {
    credential: vi.fn().mockReturnValue({ providerId: "google.com" }),
  },
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

// Mock the open package
vi.mock("open", () => ({
  default: vi.fn(),
}));

// Mock the googleAuth module
vi.mock("./googleAuth.js", () => ({
  AUTH_WARNING_MS: 60 * 1000,
  findAvailablePort: vi.fn(),
  getGoogleAuthUrl: vi.fn(),
  startAuthServer: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  generateState: vi.fn(),
  validateOAuthCredentials: vi.fn(),
  isHeadlessEnvironment: vi.fn(),
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
}));

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

  describe("loginMain with --google", () => {
    it("should authenticate via Google SSO and save credentials to config", async () => {
      const { signInWithCredential, GoogleAuthProvider } =
        await import("firebase/auth");
      const {
        findAvailablePort,
        getGoogleAuthUrl,
        startAuthServer,
        exchangeCodeForTokens,
        generateState,
      } = await import("./googleAuth.js");

      // Mock the Google OAuth flow
      vi.mocked(generateState).mockReturnValue("test-state-nonce");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/o/oauth2/v2/auth?fake=true",
      );
      vi.mocked(startAuthServer).mockResolvedValue({
        code: "google-auth-code-123",
        server: { close: vi.fn() } as any,
      });
      vi.mocked(exchangeCodeForTokens).mockResolvedValue({
        idToken: "google-id-token-abc",
        accessToken: "google-access-token-xyz",
      });

      // Mock Firebase signInWithCredential
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "firebase-refresh-token-from-google",
          email: "googleuser@gmail.com",
          getIdToken: vi
            .fn()
            .mockResolvedValue("firebase-id-token-from-google"),
        },
      } as any);

      // Mock check-access endpoint
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            authorized: true,
            organizations: ["google-org"],
            isAdmin: false,
          }),
      });

      await loginMain({ installDir: tempDir, google: true });

      // Verify Google OAuth flow was called
      expect(findAvailablePort).toHaveBeenCalled();
      expect(startAuthServer).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 9876,
          expectedState: "test-state-nonce",
        }),
      );
      expect(exchangeCodeForTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "google-auth-code-123",
        }),
      );

      // Verify Firebase signInWithCredential was called with Google credential
      expect(GoogleAuthProvider.credential).toHaveBeenCalledWith(
        "google-id-token-abc",
      );
      expect(signInWithCredential).toHaveBeenCalled();

      // Verify config was saved correctly with Google user's email
      const config = await loadConfig({ installDir: tempDir });
      expect(config).not.toBeNull();
      expect(config?.auth?.username).toBe("googleuser@gmail.com");
      expect(config?.auth?.refreshToken).toBe(
        "firebase-refresh-token-from-google",
      );
      expect(config?.auth?.organizationUrl).toBe("https://noriskillsets.dev");
      expect(config?.auth?.organizations).toEqual(["google-org"]);
    });

    it("should not prompt for email or password when --google is used", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");
      const {
        findAvailablePort,
        startAuthServer,
        exchangeCodeForTokens,
        generateState,
      } = await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(startAuthServer).mockResolvedValue({
        code: "code",
        server: { close: vi.fn() } as any,
      });
      vi.mocked(exchangeCodeForTokens).mockResolvedValue({
        idToken: "id-token",
        accessToken: "access-token",
      });
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "refresh",
          email: "user@gmail.com",
          getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
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

      await loginMain({ installDir: tempDir, google: true });

      // promptUser should NOT have been called
      expect(promptUser).not.toHaveBeenCalled();
    });

    it("should show error when --google is used with --email", async () => {
      const { error } = await import("@/cli/logger.js");

      await loginMain({
        installDir: tempDir,
        google: true,
        email: "user@example.com",
      });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("--google"),
        }),
      );

      // No config should be saved
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.auth).toBeUndefined();
    });

    it("should show error when --google is used with --password", async () => {
      const { error } = await import("@/cli/logger.js");

      await loginMain({
        installDir: tempDir,
        google: true,
        password: "secret",
      });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("--google"),
        }),
      );
    });

    it("should show error when --google is used with --non-interactive", async () => {
      const { error } = await import("@/cli/logger.js");

      await loginMain({
        installDir: tempDir,
        google: true,
        nonInteractive: true,
      });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("--non-interactive"),
        }),
      );

      // No config should be saved
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.auth).toBeUndefined();
    });

    it("should handle auth server timeout gracefully", async () => {
      const { error } = await import("@/cli/logger.js");
      const { findAvailablePort, startAuthServer, generateState } =
        await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(startAuthServer).mockRejectedValue(
        new Error("Authentication timed out"),
      );

      await loginMain({ installDir: tempDir, google: true });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Authentication failed"),
        }),
      );

      // No config should be saved
      const config = await loadConfig({ installDir: tempDir });
      expect(config?.auth).toBeUndefined();
    });

    it("should handle Firebase signInWithCredential failure", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const { error } = await import("@/cli/logger.js");
      const {
        findAvailablePort,
        startAuthServer,
        exchangeCodeForTokens,
        generateState,
      } = await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(startAuthServer).mockResolvedValue({
        code: "code",
        server: { close: vi.fn() } as any,
      });
      vi.mocked(exchangeCodeForTokens).mockResolvedValue({
        idToken: "google-id-token",
        accessToken: "access-token",
      });

      // Firebase rejects the credential
      const authError = new Error("Google sign-in not enabled");
      (authError as any).code = "auth/operation-not-allowed";
      vi.mocked(signInWithCredential).mockRejectedValue(authError);

      await loginMain({ installDir: tempDir, google: true });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Authentication failed"),
        }),
      );
    });

    it("should preserve existing config fields when logging in via Google", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const {
        findAvailablePort,
        startAuthServer,
        exchangeCodeForTokens,
        generateState,
      } = await import("./googleAuth.js");

      // Create existing config with agents and settings
      const existingConfigPath = getConfigPath({ installDir: tempDir });
      await fs.writeFile(
        existingConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          autoupdate: "enabled",
          installDir: tempDir,
        }),
      );

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(startAuthServer).mockResolvedValue({
        code: "code",
        server: { close: vi.fn() } as any,
      });
      vi.mocked(exchangeCodeForTokens).mockResolvedValue({
        idToken: "google-id-token",
        accessToken: "access-token",
      });
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "google-refresh",
          email: "user@gmail.com",
          getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
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

      await loginMain({ installDir: tempDir, google: true });

      const config = await loadConfig({ installDir: tempDir });
      expect(config?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(config?.autoupdate).toBe("enabled");
      expect(config?.auth?.username).toBe("user@gmail.com");
    });

    it("should always display auth URL before opening browser", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const { info } = await import("@/cli/logger.js");
      const {
        findAvailablePort,
        getGoogleAuthUrl,
        startAuthServer,
        exchangeCodeForTokens,
        generateState,
        isHeadlessEnvironment,
      } = await import("./googleAuth.js");

      const testAuthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=test";

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(getGoogleAuthUrl).mockReturnValue(testAuthUrl);
      vi.mocked(isHeadlessEnvironment).mockReturnValue(false);
      vi.mocked(startAuthServer).mockResolvedValue({
        code: "code",
        server: { close: vi.fn() } as any,
      });
      vi.mocked(exchangeCodeForTokens).mockResolvedValue({
        idToken: "id-token",
        accessToken: "access-token",
      });
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "refresh",
          email: "user@gmail.com",
          getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
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

      await loginMain({ installDir: tempDir, google: true });

      // Verify the auth URL was displayed
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(testAuthUrl),
        }),
      );
    });

    it("should display SSH port forwarding instructions in headless environment", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const { info } = await import("@/cli/logger.js");
      const {
        findAvailablePort,
        getGoogleAuthUrl,
        startAuthServer,
        exchangeCodeForTokens,
        generateState,
        isHeadlessEnvironment,
      } = await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/test",
      );
      vi.mocked(isHeadlessEnvironment).mockReturnValue(true); // Simulate SSH environment
      vi.mocked(startAuthServer).mockResolvedValue({
        code: "code",
        server: { close: vi.fn() } as any,
      });
      vi.mocked(exchangeCodeForTokens).mockResolvedValue({
        idToken: "id-token",
        accessToken: "access-token",
      });
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "refresh",
          email: "user@gmail.com",
          getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
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

      await loginMain({ installDir: tempDir, google: true });

      // Verify SSH port forwarding instructions were displayed
      const infoCalls = vi.mocked(info).mock.calls.map((call) => call[0]);
      const hasPortForwardingInstruction = infoCalls.some(
        (call) => call.message.includes("ssh") && call.message.includes("9876"),
      );
      expect(hasPortForwardingInstruction).toBe(true);
    });
  });
});
