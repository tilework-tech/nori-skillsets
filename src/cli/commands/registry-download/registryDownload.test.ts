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
  REGISTRAR_URL: "https://registrar.tilework.tech",
  registrarApi: {
    getPackument: vi.fn(),
    downloadTarball: vi.fn(),
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
    profilesDir = path.join(testDir, ".claude", "profiles");

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
      const customProfilesDir = path.join(
        customInstallDir,
        ".claude",
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
