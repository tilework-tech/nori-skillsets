/**
 * Tests for registry-download CLI command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import * as tar from "tar";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the registrar API
vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://noriskillsets.dev",
  registrarApi: {
    getPackument: vi.fn(),
    downloadTarball: vi.fn(),
    getSkillPackument: vi.fn(),
    downloadSkillTarball: vi.fn(),
  },
}));

// Mock the config module - include getInstalledAgents with real implementation
vi.mock("@/cli/config.js", async () => {
  return {
    loadConfig: vi.fn(),
    getRegistryAuth: vi.fn(),
    getInstalledAgents: (args: {
      config: { agents?: Record<string, unknown> | null };
    }) => {
      const agents = Object.keys(args.config.agents ?? {});
      return agents.length > 0 ? agents : ["claude-code"];
    },
  };
});

// Mock the registry auth module
vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

// Mock console methods to capture output
const mockConsoleLog = vi
  .spyOn(console, "log")
  .mockImplementation(() => undefined);
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";

import { registryDownloadMain } from "./registryDownload.js";

describe("registry-download", () => {
  let testDir: string;
  let configPath: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-registry-download-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");
    // Profiles are stored in .nori/profiles, not .claude/profiles
    profilesDir = path.join(testDir, ".nori", "profiles");

    // Create initial config
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: {
          baseProfile: "senior-swe",
        },
      }),
    );

    // Create profiles directory
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("registryDownloadMain", () => {
    it("should download and install profile to correct directory", async () => {
      // Mock config (no private registries)
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Mock getPackument to return package info
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify API was called with registry URL
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: undefined,
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      // Verify profile was extracted to correct location
      const profileDir = path.join(profilesDir, "test-profile");
      const stats = await fs.stat(profileDir);
      expect(stats.isDirectory()).toBe(true);

      // Verify files were extracted
      const packageJson = await fs.readFile(
        path.join(profileDir, "package.json"),
        "utf-8",
      );
      expect(JSON.parse(packageJson).name).toBe("test-profile");

      // Verify success message
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("download");
      expect(allOutput).toContain("test-profile");

      // Verify .nori-version file was created
      const versionFilePath = path.join(profileDir, ".nori-version");
      const versionFileContent = await fs.readFile(versionFilePath, "utf-8");
      const versionInfo = JSON.parse(versionFileContent);
      expect(versionInfo.version).toBe("1.0.0");
      expect(versionInfo.registryUrl).toBe(REGISTRAR_URL);
    });

    it("should handle version specification", async () => {
      // Mock config (no private registries)
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Mock getPackument to return package info
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: { "2.0.0": { name: "test-profile", version: "2.0.0" } },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile@2.0.0",
        cwd: testDir,
      });

      // Verify version was passed to API with registry URL
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: "2.0.0",
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });
    });

    it("should error when profile already exists", async () => {
      // Create existing profile directory
      const existingProfileDir = path.join(profilesDir, "existing-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });

      await registryDownloadMain({
        packageSpec: "existing-profile",
        cwd: testDir,
      });

      // Verify error message about already existing
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("already exists");
    });

    it("should error when no Nori installation found", async () => {
      // Create directory without .nori-config.json
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );

      try {
        await registryDownloadMain({
          packageSpec: "test-profile",
          cwd: noInstallDir,
        });

        // Verify error message about no installation
        const allErrorOutput = mockConsoleError.mock.calls
          .map((call) => call.join(" "))
          .join("\n");
        expect(allErrorOutput.toLowerCase()).toContain("no");
        expect(allErrorOutput.toLowerCase()).toContain("installation");
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should error when multiple installations found", async () => {
      // Create a nested installation
      const nestedDir = path.join(testDir, "nested");
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(
        path.join(nestedDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: nestedDir,
      });

      // Verify error message about multiple installations
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("multiple");
    });

    it("should handle download errors gracefully", async () => {
      vi.mocked(registrarApi.downloadTarball).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify error message
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("error");
      expect(allErrorOutput).toContain("Network error");
    });

    it("should support gzipped tarballs", async () => {
      const mockTarball = await createMockTarball({ gzip: true });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "gzipped-profile",
        cwd: testDir,
      });

      // Verify profile was extracted
      const profileDir = path.join(profilesDir, "gzipped-profile");
      const stats = await fs.stat(profileDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should use --install-dir option when provided", async () => {
      // Create a separate installation directory
      const customInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-custom-install-"),
      );
      // Profiles are stored in .nori/profiles, not .claude/profiles
      const customProfilesDir = path.join(
        customInstallDir,
        ".nori",
        "profiles",
      );
      await fs.mkdir(customProfilesDir, { recursive: true });
      await fs.writeFile(
        path.join(customInstallDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      try {
        await registryDownloadMain({
          packageSpec: "custom-profile",
          installDir: customInstallDir,
        });

        // Verify profile was installed to custom directory
        const profileDir = path.join(customProfilesDir, "custom-profile");
        const stats = await fs.stat(profileDir);
        expect(stats.isDirectory()).toBe(true);
      } finally {
        await fs.rm(customInstallDir, { recursive: true, force: true });
      }
    });
  });

  describe("multi-registry support", () => {
    it("should search all registries when no registry URL specified", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      // Mock config with private registry auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      // Mock auth token
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Package only exists in public registry
      vi.mocked(registrarApi.getPackument).mockImplementation(async (args) => {
        if (args.registryUrl === REGISTRAR_URL) {
          return {
            name: "test-profile",
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
          };
        }
        throw new Error("Not found");
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify both registries were searched
      expect(registrarApi.getPackument).toHaveBeenCalledWith({
        packageName: "test-profile",
        registryUrl: REGISTRAR_URL,
      });
      expect(registrarApi.getPackument).toHaveBeenCalledWith({
        packageName: "test-profile",
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify download succeeded from public registry
      const profileDir = path.join(profilesDir, "test-profile");
      const stats = await fs.stat(profileDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should error with disambiguation when package found in multiple registries", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      // Mock config with private registry auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      // Mock auth token
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Package exists in BOTH registries
      vi.mocked(registrarApi.getPackument).mockImplementation(async (args) => {
        if (args.registryUrl === REGISTRAR_URL) {
          return {
            name: "test-profile",
            description: "Public version",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": { name: "test-profile", version: "1.0.0" },
            } as Record<string, { name: string; version: string }>,
          };
        }
        if (args.registryUrl === privateRegistryUrl) {
          return {
            name: "test-profile",
            description: "Private version",
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "2.0.0": { name: "test-profile", version: "2.0.0" },
            } as Record<string, { name: string; version: string }>,
          };
        }
        throw new Error("Not found");
      });

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify error message about multiple packages
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("multiple");
      expect(allErrorOutput).toContain(REGISTRAR_URL);
      expect(allErrorOutput).toContain(privateRegistryUrl);
      expect(allErrorOutput).toContain("--registry");

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();
    });

    it("should download from single registry when package only in one", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      // Mock config with private registry auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      // Mock auth token
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Package only exists in private registry
      vi.mocked(registrarApi.getPackument).mockImplementation(async (args) => {
        if (args.registryUrl === privateRegistryUrl) {
          return {
            name: "private-profile",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": { name: "private-profile", version: "1.0.0" },
            },
          };
        }
        throw new Error("Not found");
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "private-profile",
        cwd: testDir,
      });

      // Verify download was from private registry with auth
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "private-profile",
        version: undefined,
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify profile was installed
      const profileDir = path.join(profilesDir, "private-profile");
      const stats = await fs.stat(profileDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should use --registry option to download from specific public registry", async () => {
      // Mock config (with private registry, but we'll specify public)
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: "https://private.registry.com",
            username: "user",
            password: "pass",
          },
        ],
      });

      // Package exists in public registry
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
        registryUrl: REGISTRAR_URL,
      });

      // Verify only public registry was searched (no auth token)
      expect(registrarApi.getPackument).toHaveBeenCalledTimes(1);
      expect(registrarApi.getPackument).toHaveBeenCalledWith({
        packageName: "test-profile",
        registryUrl: REGISTRAR_URL,
      });

      // Verify download was from public registry
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "test-profile",
        version: undefined,
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });
    });

    it("should use --registry option with auth for private registry", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      // Mock config with private registry auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      // Mock getRegistryAuth to return the auth config
      vi.mocked(getRegistryAuth).mockReturnValue({
        registryUrl: privateRegistryUrl,
        username: "user",
        password: "pass",
      });

      // Mock auth token
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Package exists in private registry
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "private-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "private-profile", version: "1.0.0" } },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "private-profile",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
      });

      // Verify only private registry was searched with auth
      expect(registrarApi.getPackument).toHaveBeenCalledTimes(1);
      expect(registrarApi.getPackument).toHaveBeenCalledWith({
        packageName: "private-profile",
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify download was from private registry with auth
      expect(registrarApi.downloadTarball).toHaveBeenCalledWith({
        packageName: "private-profile",
        version: undefined,
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });
    });

    it("should error when private registry specified but no auth configured", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      // Mock config WITHOUT the private registry auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Mock getRegistryAuth to return null (no auth configured)
      vi.mocked(getRegistryAuth).mockReturnValue(null);

      await registryDownloadMain({
        packageSpec: "private-profile",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
      });

      // Verify error about no auth configured
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("auth");

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();
    });

    it("should work when config is null (only searches public registry)", async () => {
      // Mock config to return null
      vi.mocked(loadConfig).mockResolvedValue(null);

      // Package exists in public registry
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify only public registry was searched
      expect(registrarApi.getPackument).toHaveBeenCalledTimes(1);
      expect(registrarApi.getPackument).toHaveBeenCalledWith({
        packageName: "test-profile",
        registryUrl: REGISTRAR_URL,
      });

      // Verify download succeeded
      const profileDir = path.join(profilesDir, "test-profile");
      const stats = await fs.stat(profileDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should error when package not found in any registry", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      // Mock config with private registry auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      // Mock auth token
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Package not found in any registry
      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Not found"),
      );

      await registryDownloadMain({
        packageSpec: "nonexistent-profile",
        cwd: testDir,
      });

      // Verify error message about not found
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("not found");

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();
    });
  });

  describe("--list-versions flag", () => {
    it("should list available versions instead of downloading", async () => {
      // Package exists in public registry with multiple versions
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0", beta: "2.1.0-beta.1" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "1.1.0": { name: "test-profile", version: "1.1.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
          "2.1.0-beta.1": { name: "test-profile", version: "2.1.0-beta.1" },
        },
        time: {
          "1.0.0": "2024-01-01T00:00:00.000Z",
          "1.1.0": "2024-02-01T00:00:00.000Z",
          "2.0.0": "2024-03-01T00:00:00.000Z",
          "2.1.0-beta.1": "2024-04-01T00:00:00.000Z",
        },
      });

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
        listVersions: true,
      });

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

      // Verify version list was displayed
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("test-profile");
      expect(allOutput).toContain("latest");
      expect(allOutput).toContain("2.0.0");
      expect(allOutput).toContain("1.0.0");
    });

    it("should list versions with --registry flag", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        registryUrl: privateRegistryUrl,
        username: "user",
        password: "pass",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "private-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "private-profile", version: "1.0.0" },
        },
      });

      await registryDownloadMain({
        packageSpec: "private-profile",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
        listVersions: true,
      });

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

      // Verify version list was displayed
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("private-profile");
      expect(allOutput).toContain(privateRegistryUrl);
    });

    it("should error when package not found with --list-versions", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockRejectedValue(
        new Error("Not found"),
      );

      await registryDownloadMain({
        packageSpec: "nonexistent-profile",
        cwd: testDir,
        listVersions: true,
      });

      // Verify error message about not found
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("not found");
    });
  });

  describe("version comparison and update", () => {
    it("should update existing profile when newer version is available", async () => {
      // Create existing profile with old version
      const existingProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(existingProfileDir, "CLAUDE.md"),
        "# Old version",
      );
      await fs.writeFile(
        path.join(existingProfileDir, ".nori-version"),
        JSON.stringify({ version: "1.0.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Registry has newer version
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify download occurred
      expect(registrarApi.downloadTarball).toHaveBeenCalled();

      // Verify success message about update
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("updated");
    });

    it("should report when already at latest version", async () => {
      // Create existing profile with same version as latest
      const existingProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(existingProfileDir, "CLAUDE.md"),
        "# Current version",
      );
      await fs.writeFile(
        path.join(existingProfileDir, ".nori-version"),
        JSON.stringify({ version: "1.0.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Registry has same version
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

      // Verify message about already at version
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("already");
    });

    it("should error when existing profile has no .nori-version", async () => {
      // Create existing profile without .nori-version (manual install)
      const existingProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(existingProfileDir, "CLAUDE.md"),
        "# Manual install",
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Registry has version
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
        },
      });

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

      // Verify error message about no version info
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput).toContain(".nori-version");
    });

    it("should report when installed version is newer than requested", async () => {
      // Create existing profile with newer version
      const existingProfileDir = path.join(profilesDir, "test-profile");
      await fs.mkdir(existingProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(existingProfileDir, "CLAUDE.md"),
        "# Newer version",
      );
      await fs.writeFile(
        path.join(existingProfileDir, ".nori-version"),
        JSON.stringify({ version: "2.0.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Request older version
      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-profile", version: "1.0.0" },
          "2.0.0": { name: "test-profile", version: "2.0.0" },
        },
      });

      await registryDownloadMain({
        packageSpec: "test-profile@1.0.0",
        cwd: testDir,
      });

      // Verify no download occurred
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

      // Verify message about already at newer version
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("already");
      expect(allOutput).toContain("2.0.0");
    });
  });

  describe("cursor-agent validation", () => {
    it("should fail when only cursor-agent is installed", async () => {
      // Mock config with only cursor-agent installed
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
      });

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Should not make any API calls
      expect(registrarApi.getPackument).not.toHaveBeenCalled();
      expect(registrarApi.downloadTarball).not.toHaveBeenCalled();

      // Should display error message about cursor-agent not being supported
      const allOutput = [
        ...mockConsoleLog.mock.calls,
        ...mockConsoleError.mock.calls,
      ]
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("not supported");
      expect(allOutput.toLowerCase()).toContain("cursor");
      expect(allOutput).toContain("claude-code");
    });

    it("should succeed when only claude-code is installed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Should make API calls since claude-code is installed
      expect(registrarApi.getPackument).toHaveBeenCalled();
    });

    it("should succeed when both agents are installed", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
          "cursor-agent": { profile: { baseProfile: "amol" } },
        },
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const mockTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(mockTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Should make API calls since claude-code is also installed
      expect(registrarApi.getPackument).toHaveBeenCalled();
    });
  });

  describe("nori.json skill dependencies", () => {
    let skillsDir: string;

    beforeEach(async () => {
      // Create skills directory
      skillsDir = path.join(testDir, ".nori", "skills");
      await fs.mkdir(skillsDir, { recursive: true });
    });

    it("should download skill dependencies listed in nori.json", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      // Create profile tarball with nori.json containing skill dependencies
      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "test-profile",
          version: "1.0.0",
          dependencies: {
            skills: {
              "test-skill": "^1.0.0",
            },
          },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      // Mock skill packument and tarball
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.2.0" },
        versions: {
          "1.0.0": { name: "test-skill", version: "1.0.0" },
          "1.2.0": { name: "test-skill", version: "1.2.0" },
        },
      });

      const skillTarball = await createMockSkillTarball({
        skillName: "test-skill",
      });
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        skillTarball,
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify skill was downloaded from the same registry as the profile
      expect(registrarApi.getSkillPackument).toHaveBeenCalledWith({
        skillName: "test-skill",
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "test-skill",
        version: "1.2.0", // Always uses latest version
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      // Verify skill was installed to correct location
      const skillDir = path.join(skillsDir, "test-skill");
      const stats = await fs.stat(skillDir);
      expect(stats.isDirectory()).toBe(true);

      // Verify skill has .nori-version file
      const skillVersionFile = path.join(skillDir, ".nori-version");
      const skillVersionContent = await fs.readFile(skillVersionFile, "utf-8");
      const skillVersionInfo = JSON.parse(skillVersionContent);
      expect(skillVersionInfo.version).toBe("1.2.0");
    });

    it("should download multiple skill dependencies", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "test-profile",
          version: "1.0.0",
          dependencies: {
            skills: {
              "skill-one": "^1.0.0",
              "skill-two": "^2.0.0",
            },
          },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      vi.mocked(registrarApi.getSkillPackument).mockImplementation(
        async (args) => {
          if (args.skillName === "skill-one") {
            return {
              name: "skill-one",
              "dist-tags": { latest: "1.5.0" },
              versions: {
                "1.5.0": { name: "skill-one", version: "1.5.0" },
              } as Record<string, { name: string; version: string }>,
            };
          }
          if (args.skillName === "skill-two") {
            return {
              name: "skill-two",
              "dist-tags": { latest: "2.3.0" },
              versions: {
                "2.3.0": { name: "skill-two", version: "2.3.0" },
              } as Record<string, { name: string; version: string }>,
            };
          }
          throw new Error("Not found");
        },
      );

      vi.mocked(registrarApi.downloadSkillTarball).mockImplementation(
        async (args) => {
          return await createMockSkillTarball({ skillName: args.skillName });
        },
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify both skills were downloaded
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledTimes(2);

      // Verify both skills were installed
      const skillOneDir = path.join(skillsDir, "skill-one");
      const skillTwoDir = path.join(skillsDir, "skill-two");
      expect((await fs.stat(skillOneDir)).isDirectory()).toBe(true);
      expect((await fs.stat(skillTwoDir)).isDirectory()).toBe(true);
    });

    it("should skip profile without nori.json (legacy profile)", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "legacy-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "legacy-profile", version: "1.0.0" } },
      });

      // Profile without nori.json
      const profileTarball = await createMockTarball();
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      await registryDownloadMain({
        packageSpec: "legacy-profile",
        cwd: testDir,
      });

      // Verify no skill downloads were attempted
      expect(registrarApi.getSkillPackument).not.toHaveBeenCalled();
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();

      // Verify profile was still installed successfully
      const profileDir = path.join(profilesDir, "legacy-profile");
      expect((await fs.stat(profileDir)).isDirectory()).toBe(true);
    });

    it("should skip profile with nori.json but no skill dependencies", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "test-profile",
          version: "1.0.0",
          // No dependencies field
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify no skill downloads were attempted
      expect(registrarApi.getSkillPackument).not.toHaveBeenCalled();
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
    });

    it("should warn but continue when skill dependency not found", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "test-profile",
          version: "1.0.0",
          dependencies: {
            skills: {
              "missing-skill": "^1.0.0",
            },
          },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      // Skill not found
      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Not found"),
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify profile was still installed successfully
      const profileDir = path.join(profilesDir, "test-profile");
      expect((await fs.stat(profileDir)).isDirectory()).toBe(true);

      // Verify warning was shown
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("missing-skill");
    });

    it("should skip skill if already installed with latest version", async () => {
      // Pre-install the skill with the latest version
      const existingSkillDir = path.join(skillsDir, "test-skill");
      await fs.mkdir(existingSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(existingSkillDir, "SKILL.md"),
        "# Test Skill",
      );
      await fs.writeFile(
        path.join(existingSkillDir, ".nori-version"),
        JSON.stringify({ version: "1.5.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "test-profile",
          version: "1.0.0",
          dependencies: {
            skills: {
              "test-skill": "^1.0.0", // Version range is ignored, always uses latest
            },
          },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      // Registry says latest is 1.5.0, which matches installed version
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.5.0" },
        versions: { "1.5.0": { name: "test-skill", version: "1.5.0" } },
      });

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify skill was NOT downloaded (already installed with latest version)
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
    });

    it("should update skill if installed version is not latest", async () => {
      // Pre-install an older version of the skill
      const existingSkillDir = path.join(skillsDir, "test-skill");
      await fs.mkdir(existingSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(existingSkillDir, "SKILL.md"),
        "# Old Test Skill",
      );
      await fs.writeFile(
        path.join(existingSkillDir, ".nori-version"),
        JSON.stringify({ version: "0.9.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "test-profile",
          version: "1.0.0",
          dependencies: {
            skills: {
              "test-skill": "^1.0.0", // Version range is ignored, always uses latest
            },
          },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      // Registry says latest is 1.2.0, but installed is 0.9.0
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.2.0" },
        versions: {
          "0.9.0": { name: "test-skill", version: "0.9.0" },
          "1.0.0": { name: "test-skill", version: "1.0.0" },
          "1.2.0": { name: "test-skill", version: "1.2.0" },
        },
      });

      const skillTarball = await createMockSkillTarball({
        skillName: "test-skill",
      });
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        skillTarball,
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify skill was updated to latest
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "test-skill",
        version: "1.2.0",
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      // Verify new version file
      const skillVersionFile = path.join(existingSkillDir, ".nori-version");
      const skillVersionContent = await fs.readFile(skillVersionFile, "utf-8");
      const skillVersionInfo = JSON.parse(skillVersionContent);
      expect(skillVersionInfo.version).toBe("1.2.0");
    });

    it("should use same registry and auth token for skill downloads", async () => {
      const privateRegistryUrl = "https://private.registry.com";

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [
          {
            registryUrl: privateRegistryUrl,
            username: "user",
            password: "pass",
          },
        ],
      });

      vi.mocked(getRegistryAuth).mockReturnValue({
        registryUrl: privateRegistryUrl,
        username: "user",
        password: "pass",
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("private-auth-token");

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "private-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "private-profile", version: "1.0.0" } },
      });

      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "private-profile",
          version: "1.0.0",
          dependencies: {
            skills: {
              "private-skill": "^1.0.0",
            },
          },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "private-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "private-skill", version: "1.0.0" } },
      });

      const skillTarball = await createMockSkillTarball({
        skillName: "private-skill",
      });
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        skillTarball,
      );

      await registryDownloadMain({
        packageSpec: "private-profile",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
      });

      // Verify skill was downloaded from the SAME private registry with auth
      expect(registrarApi.getSkillPackument).toHaveBeenCalledWith({
        skillName: "private-skill",
        registryUrl: privateRegistryUrl,
        authToken: "private-auth-token",
      });

      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "private-skill",
        version: "1.0.0",
        registryUrl: privateRegistryUrl,
        authToken: "private-auth-token",
      });
    });

    it("should always download latest version regardless of version range in nori.json", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getPackument).mockResolvedValue({
        name: "test-profile",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-profile", version: "1.0.0" } },
      });

      const profileTarball = await createMockTarballWithNoriJson({
        noriJson: {
          name: "test-profile",
          version: "1.0.0",
          dependencies: {
            skills: {
              "test-skill": "^5.0.0", // Version range is ignored
            },
          },
        },
      });
      vi.mocked(registrarApi.downloadTarball).mockResolvedValue(profileTarball);

      // Skill exists with latest 2.0.0 (which doesn't match ^5.0.0 but we ignore that)
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-skill", version: "1.0.0" },
          "2.0.0": { name: "test-skill", version: "2.0.0" },
        },
      });

      const skillTarball = await createMockSkillTarball({
        skillName: "test-skill",
      });
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        skillTarball,
      );

      await registryDownloadMain({
        packageSpec: "test-profile",
        cwd: testDir,
      });

      // Verify skill was downloaded with latest version (ignoring semver range)
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "test-skill",
        version: "2.0.0", // Always latest, not semver resolved
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      // Verify profile was installed successfully
      const profileDir = path.join(profilesDir, "test-profile");
      expect((await fs.stat(profileDir)).isDirectory()).toBe(true);
    });
  });
});

/**
 * Creates a minimal mock tarball for testing
 * @param args - The tarball options
 * @param args.gzip - Whether to gzip the tarball (default: false)
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockTarball = async (args?: {
  gzip?: boolean | null;
}): Promise<ArrayBuffer> => {
  const gzip = args?.gzip ?? false;
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "mock-tarball-source-"));
  const tarballPath = path.join(
    tmpdir(),
    `mock-tarball-${Date.now()}.${gzip ? "tgz" : "tar"}`,
  );

  try {
    // Create mock files
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );
    await fs.writeFile(path.join(tempDir, "AGENT.md"), "# Test Profile Agent");

    // Create the tarball synchronously to avoid race condition
    tar.create(
      {
        gzip,
        file: tarballPath,
        cwd: tempDir,
        sync: true,
      },
      ["package.json", "AGENT.md"],
    );

    // Read the tarball as ArrayBuffer
    const tarballBuffer = await fs.readFile(tarballPath);
    const arrayBuffer = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(tarballBuffer);
    return arrayBuffer;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    try {
      await fs.unlink(tarballPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
};

/**
 * Creates a mock tarball with nori.json for testing skill dependencies
 * @param args - The tarball options
 * @param args.noriJson - The nori.json content to include
 * @param args.noriJson.name - The profile name
 * @param args.noriJson.version - The profile version
 * @param args.noriJson.dependencies - Optional skill dependencies
 * @param args.gzip - Whether to gzip the tarball (default: true)
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockTarballWithNoriJson = async (args: {
  noriJson: {
    name: string;
    version: string;
    dependencies?: {
      skills?: Record<string, string>;
    } | null;
  };
  gzip?: boolean | null;
}): Promise<ArrayBuffer> => {
  const { noriJson } = args;
  const gzip = args.gzip ?? true;
  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), "mock-tarball-nori-json-"),
  );
  const tarballPath = path.join(
    tmpdir(),
    `mock-tarball-nori-${Date.now()}.${gzip ? "tgz" : "tar"}`,
  );

  try {
    // Create mock files including nori.json
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: noriJson.name, version: noriJson.version }),
    );
    await fs.writeFile(
      path.join(tempDir, "nori.json"),
      JSON.stringify(noriJson, null, 2),
    );
    await fs.writeFile(path.join(tempDir, "CLAUDE.md"), "# Test Profile");

    // Create the tarball synchronously
    tar.create(
      {
        gzip,
        file: tarballPath,
        cwd: tempDir,
        sync: true,
      },
      ["package.json", "nori.json", "CLAUDE.md"],
    );

    // Read the tarball as ArrayBuffer
    const tarballBuffer = await fs.readFile(tarballPath);
    const arrayBuffer = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(tarballBuffer);
    return arrayBuffer;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    try {
      await fs.unlink(tarballPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
};

/**
 * Creates a minimal mock skill tarball for testing
 * @param args - The tarball options
 * @param args.skillName - The skill name
 * @param args.gzip - Whether to gzip the tarball (default: true)
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockSkillTarball = async (args: {
  skillName: string;
  gzip?: boolean | null;
}): Promise<ArrayBuffer> => {
  const { skillName } = args;
  const gzip = args.gzip ?? true;
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "mock-skill-tarball-"));
  const tarballPath = path.join(
    tmpdir(),
    `mock-skill-${Date.now()}.${gzip ? "tgz" : "tar"}`,
  );

  try {
    // Create mock skill files
    await fs.writeFile(
      path.join(tempDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: A test skill\n---\n\n# ${skillName}\n\nTest skill content.`,
    );

    // Create the tarball synchronously
    tar.create(
      {
        gzip,
        file: tarballPath,
        cwd: tempDir,
        sync: true,
      },
      ["SKILL.md"],
    );

    // Read the tarball as ArrayBuffer
    const tarballBuffer = await fs.readFile(tarballPath);
    const arrayBuffer = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(tarballBuffer);
    return arrayBuffer;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    try {
      await fs.unlink(tarballPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
};
