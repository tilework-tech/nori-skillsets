/**
 * Tests for the login command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getConfigPath, loadConfig } from "@/cli/config.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { loginMain } from "./login.js";

// Mock loginFlow for interactive email/password authentication
vi.mock("@/cli/prompts/index.js", () => ({
  loginFlow: vi.fn(),
}));

// Mock prompt
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
  promptYesNo: vi.fn(),
}));

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
  validateWebOAuthCredentials: vi.fn(),
  isHeadlessEnvironment: vi.fn(),
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_OAUTH_WEB_CLIENT_ID: "test-web-client-id",
}));

describe("login command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "login-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loginMain with legacy prompts (default)", () => {
    it("should use legacy prompts when experimentalUi is not set", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Mock promptUser for email and password
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

      // Verify promptUser was called for email and password
      expect(promptUser).toHaveBeenCalledTimes(2);
      expect(promptUser).toHaveBeenNthCalledWith(1, { prompt: "Email: " });
      expect(promptUser).toHaveBeenNthCalledWith(2, {
        prompt: "Password: ",
        masked: true,
      });

      // Verify loginFlow was NOT called
      expect(loginFlow).not.toHaveBeenCalled();

      // Verify config was saved correctly
      const config = await loadConfig();
      expect(config).not.toBeNull();
      expect(config?.auth?.username).toBe("user@example.com");
      expect(config?.auth?.refreshToken).toBe("mock-refresh-token");
    });

    it("should handle empty email input with legacy prompts", async () => {
      const { promptUser } = await import("@/cli/prompt.js");
      const { error: logError } = await import("@/cli/logger.js");

      // Mock promptUser to return empty email
      vi.mocked(promptUser).mockResolvedValueOnce("");

      await loginMain({ installDir: tempDir });

      // Verify error was logged
      expect(logError).toHaveBeenCalledWith({
        message: "Email is required.",
      });

      // No config should be saved
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
    });

    it("should handle empty password input with legacy prompts", async () => {
      const { promptUser } = await import("@/cli/prompt.js");
      const { error: logError } = await import("@/cli/logger.js");

      // Mock promptUser for email then empty password
      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com")
        .mockResolvedValueOnce("");

      await loginMain({ installDir: tempDir });

      // Verify error was logged
      expect(logError).toHaveBeenCalledWith({
        message: "Password is required.",
      });

      // No config should be saved
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
    });

    it("should show auth errors with legacy prompts", async () => {
      const { signInWithEmailAndPassword, AuthErrorCodes } =
        await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");
      const { error: logError } = await import("@/cli/logger.js");

      // Mock promptUser
      vi.mocked(promptUser)
        .mockResolvedValueOnce("user@example.com")
        .mockResolvedValueOnce("wrongpassword");

      // Mock Firebase to throw invalid credentials error
      const authError = new Error("Invalid credentials");
      (authError as any).code = AuthErrorCodes.INVALID_LOGIN_CREDENTIALS;
      vi.mocked(signInWithEmailAndPassword).mockRejectedValue(authError);

      await loginMain({ installDir: tempDir });

      // Verify error was logged
      expect(logError).toHaveBeenCalledWith({
        message: "Authentication failed",
      });

      // No config should be saved
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
    });
  });

  describe("loginMain with --experimental-ui", () => {
    it("should authenticate with Firebase and save credentials to config", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Mock loginFlow to simulate the flow calling the authenticate callback
      vi.mocked(loginFlow).mockImplementation(async (args) => {
        const result = await args.callbacks.onAuthenticate({
          email: "user@example.com",
          password: "password123",
        });
        if (!result.success) {
          return null;
        }
        return {
          email: "user@example.com",
          refreshToken: result.refreshToken,
          idToken: result.idToken,
          organizations: result.organizations,
          isAdmin: result.isAdmin,
        };
      });

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

      await loginMain({ installDir: tempDir, experimentalUi: true });

      // Verify loginFlow was called
      expect(loginFlow).toHaveBeenCalled();

      // Verify config was saved correctly
      const config = await loadConfig();
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
      const config = await loadConfig();
      expect(config?.auth?.username).toBe("test@example.com");
    });

    it("should show error for invalid credentials", async () => {
      const { signInWithEmailAndPassword, AuthErrorCodes } =
        await import("firebase/auth");
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Mock Firebase to throw invalid credentials error
      const authError = new Error("Invalid credentials");
      (authError as any).code = AuthErrorCodes.INVALID_LOGIN_CREDENTIALS;
      vi.mocked(signInWithEmailAndPassword).mockRejectedValue(authError);

      // Mock loginFlow to call authenticate callback which will fail
      vi.mocked(loginFlow).mockImplementation(async (args) => {
        const result = await args.callbacks.onAuthenticate({
          email: "user@example.com",
          password: "wrongpassword",
        });
        // Flow returns null on auth failure
        if (!result.success) {
          return null;
        }
        return {
          email: "user@example.com",
          refreshToken: result.refreshToken,
          idToken: result.idToken,
          organizations: result.organizations,
          isAdmin: result.isAdmin,
        };
      });

      await loginMain({ installDir: tempDir, experimentalUi: true });

      // Verify loginFlow was called and returned null (indicating failure)
      expect(loginFlow).toHaveBeenCalled();

      // Verify no config was saved
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
    });

    it("should preserve existing config fields when logging in", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Create existing config with agents and settings
      const existingConfigPath = getConfigPath();
      await fs.writeFile(
        existingConfigPath,
        JSON.stringify({
          agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
          autoupdate: "enabled",
          installDir: tempDir,
        }),
      );

      // Mock loginFlow
      vi.mocked(loginFlow).mockImplementation(async (args) => {
        const result = await args.callbacks.onAuthenticate({
          email: "user@example.com",
          password: "password123",
        });
        if (!result.success) {
          return null;
        }
        return {
          email: "user@example.com",
          refreshToken: result.refreshToken,
          idToken: result.idToken,
          organizations: result.organizations,
          isAdmin: result.isAdmin,
        };
      });

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

      await loginMain({ installDir: tempDir, experimentalUi: true });

      // Verify existing fields are preserved
      const config = await loadConfig();
      expect(config?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(config?.autoupdate).toBe("enabled");
      // And new auth was added
      expect(config?.auth?.username).toBe("user@example.com");
    });

    it("should preserve transcriptDestination when logging in", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Create existing config with transcriptDestination
      const existingConfigPath = getConfigPath();
      await fs.writeFile(
        existingConfigPath,
        JSON.stringify({
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
          transcriptDestination: "myorg",
          installDir: tempDir,
        }),
      );

      // Mock loginFlow
      vi.mocked(loginFlow).mockImplementation(async (args) => {
        const result = await args.callbacks.onAuthenticate({
          email: "user@example.com",
          password: "password123",
        });
        if (!result.success) {
          return null;
        }
        return {
          email: "user@example.com",
          refreshToken: result.refreshToken,
          idToken: result.idToken,
          organizations: result.organizations,
          isAdmin: result.isAdmin,
        };
      });

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
            organizations: ["acme"],
            isAdmin: false,
          }),
      });

      await loginMain({ installDir: tempDir, experimentalUi: true });

      // Verify transcriptDestination was preserved
      const config = await loadConfig();
      expect(config?.transcriptDestination).toBe("myorg");
      // And new auth was added
      expect(config?.auth?.username).toBe("user@example.com");
    });

    it("should save auth with empty organizations if check-access fails", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Mock loginFlow
      vi.mocked(loginFlow).mockImplementation(async (args) => {
        const result = await args.callbacks.onAuthenticate({
          email: "user@example.com",
          password: "password123",
        });
        if (!result.success) {
          return null;
        }
        return {
          email: "user@example.com",
          refreshToken: result.refreshToken,
          idToken: result.idToken,
          organizations: result.organizations,
          isAdmin: result.isAdmin,
        };
      });

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

      await loginMain({ installDir: tempDir, experimentalUi: true });

      // Verify auth was saved with empty organizations
      const config = await loadConfig();
      expect(config?.auth?.username).toBe("user@example.com");
      expect(config?.auth?.refreshToken).toBe("mock-refresh-token");
      expect(config?.auth?.organizations).toEqual([]);
    });

    it("should handle network failure during check-access gracefully", async () => {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Mock loginFlow
      vi.mocked(loginFlow).mockImplementation(async (args) => {
        const result = await args.callbacks.onAuthenticate({
          email: "user@example.com",
          password: "password123",
        });
        if (!result.success) {
          return null;
        }
        return {
          email: "user@example.com",
          refreshToken: result.refreshToken,
          idToken: result.idToken,
          organizations: result.organizations,
          isAdmin: result.isAdmin,
        };
      });

      vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
        user: {
          refreshToken: "mock-refresh-token",
          getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
        },
      } as any);

      // Mock fetch to throw network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      await loginMain({ installDir: tempDir, experimentalUi: true });

      // Verify auth was saved with empty organizations
      const config = await loadConfig();
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

    it("should handle login flow cancellation", async () => {
      const { loginFlow } = await import("@/cli/prompts/index.js");

      // Mock loginFlow to return null (cancelled)
      vi.mocked(loginFlow).mockResolvedValue(null);

      await loginMain({ installDir: tempDir, experimentalUi: true });

      // Verify loginFlow was called
      expect(loginFlow).toHaveBeenCalled();

      // Verify no config was saved
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
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
        isHeadlessEnvironment,
      } = await import("./googleAuth.js");

      // Mock the Google OAuth flow
      vi.mocked(generateState).mockReturnValue("test-state-nonce");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/o/oauth2/v2/auth?fake=true",
      );
      vi.mocked(isHeadlessEnvironment).mockReturnValue(false); // Not headless
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
      const config = await loadConfig();
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
        isHeadlessEnvironment,
      } = await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(isHeadlessEnvironment).mockReturnValue(false); // Not headless
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

      // promptUser should NOT have been called (no email/password prompts in SSO flow)
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
      const config = await loadConfig();
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
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
    });

    it("should handle auth server timeout gracefully", async () => {
      const { error } = await import("@/cli/logger.js");
      const {
        findAvailablePort,
        startAuthServer,
        generateState,
        isHeadlessEnvironment,
      } = await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(isHeadlessEnvironment).mockReturnValue(false); // Not headless
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
      const config = await loadConfig();
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
        isHeadlessEnvironment,
      } = await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(findAvailablePort).mockResolvedValue(9876);
      vi.mocked(isHeadlessEnvironment).mockReturnValue(false); // Not headless
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
        isHeadlessEnvironment,
      } = await import("./googleAuth.js");

      // Create existing config with agents and settings
      const existingConfigPath = getConfigPath();
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
      vi.mocked(isHeadlessEnvironment).mockReturnValue(false); // Not headless
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

      const config = await loadConfig();
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

    it("should prompt user in headless environment and use headless flow when confirmed", async () => {
      const { signInWithCredential, GoogleAuthProvider } =
        await import("firebase/auth");
      const { info } = await import("@/cli/logger.js");
      const { promptUser, promptYesNo } = await import("@/cli/prompt.js");
      const { getGoogleAuthUrl, generateState, isHeadlessEnvironment } =
        await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("state");
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/test",
      );
      vi.mocked(isHeadlessEnvironment).mockReturnValue(true); // Simulate SSH environment
      vi.mocked(promptYesNo).mockResolvedValue(true); // User confirms headless flow
      vi.mocked(promptUser).mockResolvedValue("id-token-from-server");
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

      // Verify user was prompted about headless flow
      expect(promptYesNo).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("headless"),
        }),
      );

      // Verify headless flow was used (promptUser for token)
      expect(promptUser).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("token"),
          masked: true,
        }),
      );

      // Verify GoogleAuthProvider.credential was called with the pasted token
      expect(GoogleAuthProvider.credential).toHaveBeenCalledWith(
        "id-token-from-server",
      );

      // Verify headless environment info was shown
      const infoCalls = vi.mocked(info).mock.calls.map((call) => call[0]);
      const hasHeadlessInfo = infoCalls.some((call) =>
        call.message.includes("headless"),
      );
      expect(hasHeadlessInfo).toBe(true);
    });

    it("should display SSH port forwarding instructions when user declines headless flow", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const { info } = await import("@/cli/logger.js");
      const { promptYesNo } = await import("@/cli/prompt.js");
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
      vi.mocked(promptYesNo).mockResolvedValue(false); // User declines headless flow
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

  describe("loginMain with --google --no-localhost", () => {
    it("should use web client ID and noriskillsets.dev callback URL when --no-localhost is set", async () => {
      const { signInWithCredential, GoogleAuthProvider } =
        await import("firebase/auth");
      const { promptUser } = await import("@/cli/prompt.js");
      const { getGoogleAuthUrl, generateState } =
        await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("test-state");
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/test?redirect_uri=https://noriskillsets.dev/oauth/callback",
      );
      // User pastes the id_token from the server (not an auth code)
      vi.mocked(promptUser).mockResolvedValue("id-token-from-server-page");
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "refresh-token",
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

      await loginMain({ installDir: tempDir, google: true, noLocalhost: true });

      // Verify getGoogleAuthUrl was called with web client ID and noriskillsets.dev redirect URI
      expect(getGoogleAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "test-web-client-id",
          redirectUri: "https://noriskillsets.dev/oauth/callback",
        }),
      );

      // Verify user was prompted to paste the token with masked input
      expect(promptUser).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("token"),
          masked: true,
        }),
      );

      // Verify GoogleAuthProvider.credential was called with the pasted token directly
      expect(GoogleAuthProvider.credential).toHaveBeenCalledWith(
        "id-token-from-server-page",
      );

      // Verify config was saved
      const config = await loadConfig();
      expect(config?.auth?.username).toBe("user@gmail.com");
    });

    it("should not start local auth server or exchange tokens when --no-localhost is set", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const {
        getGoogleAuthUrl,
        exchangeCodeForTokens,
        generateState,
        startAuthServer,
        findAvailablePort,
      } = await import("./googleAuth.js");
      const { promptUser } = await import("@/cli/prompt.js");

      vi.mocked(generateState).mockReturnValue("test-state");
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/test",
      );
      vi.mocked(promptUser).mockResolvedValue("id-token-from-server");
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "refresh-token",
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

      await loginMain({ installDir: tempDir, google: true, noLocalhost: true });

      // Verify local server functions were NOT called
      expect(findAvailablePort).not.toHaveBeenCalled();
      expect(startAuthServer).not.toHaveBeenCalled();
      // Verify token exchange was NOT called (server handles this)
      expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it("should show error when --no-localhost is used without --google", async () => {
      const { error } = await import("@/cli/logger.js");

      await loginMain({ installDir: tempDir, noLocalhost: true });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("--no-localhost"),
        }),
      );

      // No config should be saved
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
    });

    it("should display instructions to copy the token from the callback page", async () => {
      const { signInWithCredential } = await import("firebase/auth");
      const { info } = await import("@/cli/logger.js");
      const { promptUser } = await import("@/cli/prompt.js");
      const { getGoogleAuthUrl, generateState } =
        await import("./googleAuth.js");

      vi.mocked(generateState).mockReturnValue("test-state");
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/test",
      );
      vi.mocked(promptUser).mockResolvedValue("id-token");
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "refresh-token",
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

      await loginMain({ installDir: tempDir, google: true, noLocalhost: true });

      // Verify instructions were displayed
      const infoCalls = vi.mocked(info).mock.calls.map((call) => call[0]);
      const hasInstructions = infoCalls.some(
        (call) =>
          call.message.includes("Copy") || call.message.includes("token"),
      );
      expect(hasInstructions).toBe(true);
    });

    it("should handle empty token input gracefully", async () => {
      const { error } = await import("@/cli/logger.js");
      const { getGoogleAuthUrl, generateState } =
        await import("./googleAuth.js");
      const { promptUser } = await import("@/cli/prompt.js");

      vi.mocked(generateState).mockReturnValue("test-state");
      vi.mocked(getGoogleAuthUrl).mockReturnValue(
        "https://accounts.google.com/test",
      );
      vi.mocked(promptUser).mockResolvedValue(""); // Empty input

      await loginMain({ installDir: tempDir, google: true, noLocalhost: true });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("token"),
        }),
      );

      // No config should be saved
      const config = await loadConfig();
      expect(config?.auth).toBeUndefined();
    });

    it("should validate web OAuth credentials for headless flow", async () => {
      const { validateWebOAuthCredentials } = await import("./googleAuth.js");
      const { promptUser } = await import("@/cli/prompt.js");
      const { signInWithCredential } = await import("firebase/auth");

      vi.mocked(promptUser).mockResolvedValue("id-token");
      vi.mocked(signInWithCredential).mockResolvedValue({
        user: {
          refreshToken: "refresh-token",
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

      await loginMain({ installDir: tempDir, google: true, noLocalhost: true });

      // Verify web OAuth credentials were validated
      expect(validateWebOAuthCredentials).toHaveBeenCalled();
    });
  });
});
