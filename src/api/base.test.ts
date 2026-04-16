/**
 * Tests for API base module
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ConfigManager, AuthManager } from "./base.js";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn().mockReturnValue(actual.homedir()) };
});

// Mock the refresh token exchange so we can detect if it's called unexpectedly
vi.mock("@/api/refreshToken.js", () => ({
  exchangeRefreshToken: vi.fn(),
}));

describe("ConfigManager", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nori-test-"));
    originalCwd = process.cwd();
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadConfig", () => {
    it("should load config from centralized ~/.nori-config.json", () => {
      // Setup: Write config at centralized location (homedir)
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to a subdirectory
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      process.chdir(projectDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify
      expect(result).toEqual(configData);
    });

    it("should load config when running from subdirectory", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to a nested subdirectory
      const srcDir = path.join(tempDir, "project", "src");
      fs.mkdirSync(srcDir, { recursive: true });
      process.chdir(srcDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify
      expect(result).toEqual(configData);
    });

    it("should return null when no installation found", () => {
      // Setup: Create empty directory with no config
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });

      // Change to empty directory (no config anywhere in tree)
      process.chdir(emptyDir);

      // Execute & Verify
      const result = ConfigManager.loadConfig();
      expect(result).toBeNull();
    });

    it("should handle empty config file gracefully (race condition)", () => {
      // Setup: Write empty config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      fs.writeFileSync(configPath, ""); // Empty file

      // Change to tempDir
      process.chdir(tempDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should return empty object for empty file
      expect(result).toEqual({});
    });

    it("should always read from centralized config regardless of cwd config", () => {
      // Setup: Create a project-level config and a centralized config
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Write project-level config
      const projectConfigPath = path.join(projectDir, ".nori-config.json");
      fs.writeFileSync(
        projectConfigPath,
        JSON.stringify({
          username: "project@example.com",
          password: "projectpass",
          organizationUrl: "https://project.nori.ai",
        }),
      );

      // Write centralized config at homedir
      const centralConfigPath = path.join(tempDir, ".nori-config.json");
      const centralConfigData = {
        username: "central@example.com",
        password: "centralpass",
        organizationUrl: "https://central.nori.ai",
      };
      fs.writeFileSync(
        centralConfigPath,
        JSON.stringify(centralConfigData, null, 2),
      );

      // Change to project directory
      process.chdir(projectDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should use centralized config (getConfigPath() = ~/.nori-config.json)
      expect(result).toEqual(centralConfigData);
    });

    it("should extract auth from nested format with refreshToken (v19+)", () => {
      // Setup: Write nested auth config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          refreshToken: "test-refresh-token",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to tempDir
      process.chdir(tempDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should extract auth fields to root level
      expect(result).toEqual({
        username: "test@example.com",
        password: null,
        refreshToken: "test-refresh-token",
        apiToken: null,
        organizationUrl: "https://test.nori.ai",
      });
    });

    it("should extract auth from nested format with password (v19+)", () => {
      // Setup: Write nested auth config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          password: "test-password",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to tempDir
      process.chdir(tempDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should extract auth fields to root level
      expect(result).toEqual({
        username: "test@example.com",
        password: "test-password",
        refreshToken: null,
        apiToken: null,
        organizationUrl: "https://test.nori.ai",
      });
    });
  });

  describe("isConfigured", () => {
    it("should return true for nested auth format with refreshToken", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          refreshToken: "test-refresh-token",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(true);
    });

    it("should return true for nested auth format with password", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          password: "test-password",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(true);
    });

    it("should return true for legacy flat auth format (backwards compat)", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "test-password",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(true);
    });

    it("should return false when auth is incomplete", () => {
      // Setup: Write incomplete config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          // Missing password/refreshToken and organizationUrl
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(false);
    });

    it("should return false when no config exists", () => {
      // Setup: Create empty directory with no config
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });

      // Change to empty directory
      process.chdir(emptyDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(false);
    });

    it("should return true when config has apiToken and organizationUrl but no username", () => {
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          organizationUrl: "https://acme.noriskillsets.dev",
          apiToken: `nori_acme_${"a".repeat(64)}`,
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      expect(ConfigManager.isConfigured()).toBe(true);
    });

    it("should return true when NORI_API_TOKEN is set without config file", () => {
      // Setup: no config file anywhere
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });
      process.chdir(emptyDir);
      vi.mocked(os.homedir).mockReturnValue(emptyDir);

      const origToken = process.env.NORI_API_TOKEN;
      process.env.NORI_API_TOKEN = `nori_acme_${"a".repeat(64)}`;

      try {
        expect(ConfigManager.isConfigured()).toBe(true);
      } finally {
        if (origToken == null) delete process.env.NORI_API_TOKEN;
        else process.env.NORI_API_TOKEN = origToken;
      }
    });
  });
});

describe("AuthManager.getAuthToken with apiToken", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnvToken: string | undefined;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-token-test-"));
    originalCwd = process.cwd();
    vi.mocked(os.homedir).mockReturnValue(tempDir);
    originalEnvToken = process.env.NORI_API_TOKEN;
    delete process.env.NORI_API_TOKEN;
    vi.clearAllMocks();

    // Reset module-level AuthManager cache
    AuthManager.reset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnvToken == null) delete process.env.NORI_API_TOKEN;
    else process.env.NORI_API_TOKEN = originalEnvToken;
  });

  it("should return config apiToken when token's embedded org matches organizationUrl org", async () => {
    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        auth: {
          organizationUrl: "https://acme.noriskillsets.dev",
          apiToken: `nori_acme_${"a".repeat(64)}`,
        },
      }),
    );
    process.chdir(tempDir);

    const token = await AuthManager.getAuthToken();

    expect(token).toBe(`nori_acme_${"a".repeat(64)}`);

    const { exchangeRefreshToken } = await import("@/api/refreshToken.js");
    expect(exchangeRefreshToken).not.toHaveBeenCalled();
  });

  it("should prefer NORI_API_TOKEN env var over config when token's embedded org matches target", async () => {
    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        auth: {
          organizationUrl: "https://acme.noriskillsets.dev",
          apiToken: `nori_acme_${"c".repeat(64)}`,
        },
      }),
    );
    process.chdir(tempDir);

    process.env.NORI_API_TOKEN = `nori_acme_${"b".repeat(64)}`;

    const token = await AuthManager.getAuthToken();

    expect(token).toBe(`nori_acme_${"b".repeat(64)}`);
  });

  it("should fall through to config apiToken when env-var token's org mismatches target org", async () => {
    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        auth: {
          organizationUrl: "https://acme.noriskillsets.dev",
          apiToken: `nori_acme_${"c".repeat(64)}`,
        },
      }),
    );
    process.chdir(tempDir);

    process.env.NORI_API_TOKEN = `nori_other_${"d".repeat(64)}`;

    const token = await AuthManager.getAuthToken();

    expect(token).toBe(`nori_acme_${"c".repeat(64)}`);
  });

  it("should work with env var and no config file on disk", async () => {
    process.chdir(tempDir);

    process.env.NORI_API_TOKEN = `nori_acme_${"e".repeat(64)}`;

    const token = await AuthManager.getAuthToken();

    expect(token).toBe(`nori_acme_${"e".repeat(64)}`);
  });

  it("should ignore a malformed NORI_API_TOKEN env var", async () => {
    process.chdir(tempDir);

    process.env.NORI_API_TOKEN = "not-a-valid-token";

    await expect(AuthManager.getAuthToken()).rejects.toThrow(/not configured/i);
  });

  it("should throw descriptive error when nothing configured", async () => {
    process.chdir(tempDir);

    await expect(AuthManager.getAuthToken()).rejects.toThrow(/not configured/i);
  });
});

describe("apiRequest with NORI_API_TOKEN env var and no config file", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnvToken: string | undefined;
  const mockFetch = vi.fn();

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-request-env-test-"));
    originalCwd = process.cwd();
    vi.mocked(os.homedir).mockReturnValue(tempDir);
    originalEnvToken = process.env.NORI_API_TOKEN;
    delete process.env.NORI_API_TOKEN;
    process.chdir(tempDir);
    AuthManager.reset();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnvToken == null) delete process.env.NORI_API_TOKEN;
    else process.env.NORI_API_TOKEN = originalEnvToken;
    vi.unstubAllGlobals();
  });

  it("should issue request to {org}.noriskillsets.dev with raw API token as Bearer header", async () => {
    process.env.NORI_API_TOKEN = `nori_acme_${"a".repeat(64)}`;

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "ok" }),
    });

    const { apiRequest } = await import("./base.js");

    const result = await apiRequest<{ result: string }>({
      path: "/skillsets/foo",
    });

    expect(result).toEqual({ result: "ok" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe("https://acme.noriskillsets.dev/api/skillsets/foo");
    expect(calledOptions.headers.Authorization).toBe(
      `Bearer nori_acme_${"a".repeat(64)}`,
    );
  });

  it("should NOT send config.apiToken for acme to a baseUrl targeting foo (cross-org scoping)", async () => {
    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        auth: {
          organizationUrl: "https://acme.noriskillsets.dev",
          apiToken: `nori_acme_${"a".repeat(64)}`,
          refreshToken: "acme-refresh",
          username: "user@example.com",
        },
      }),
    );

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    // Stub exchangeRefreshToken to prove the fallback path is taken instead of
    // misusing the acme-scoped API token.
    const { exchangeRefreshToken } = await import("@/api/refreshToken.js");
    vi.mocked(exchangeRefreshToken).mockResolvedValue({
      idToken: "firebase-id-token-for-foo",
      refreshToken: "new-refresh",
      expiresIn: 3600,
    });

    const { apiRequest } = await import("./base.js");

    await apiRequest({
      path: "/anything",
      baseUrl: "https://foo.noriskillsets.dev",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe("https://foo.noriskillsets.dev/api/anything");
    // The acme-scoped API token MUST NOT be sent to foo's subdomain.
    expect(calledOptions.headers.Authorization).not.toBe(
      `Bearer nori_acme_${"a".repeat(64)}`,
    );
  });

  it("should NOT cache the env-var API token value across calls", async () => {
    process.env.NORI_API_TOKEN = `nori_acme_${"1".repeat(64)}`;

    const t1 = await AuthManager.getAuthToken();
    expect(t1).toBe(`nori_acme_${"1".repeat(64)}`);

    // Rotate the env var — a fresh call must pick up the new value.
    process.env.NORI_API_TOKEN = `nori_acme_${"2".repeat(64)}`;

    const t2 = await AuthManager.getAuthToken();
    expect(t2).toBe(`nori_acme_${"2".repeat(64)}`);
  });
});
