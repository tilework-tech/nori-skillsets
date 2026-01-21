/**
 * Tests for skill-download CLI command
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

import { skillDownloadMain } from "./skillDownload.js";

describe("skill-download", () => {
  let testDir: string;
  let configPath: string;
  let skillsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-skill-download-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");
    // Skills are now stored directly in .claude/skills (the live profile directory)
    skillsDir = path.join(testDir, ".claude", "skills");

    // Create initial config
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: {
          baseProfile: "senior-swe",
        },
      }),
    );

    // Create skills directory
    await fs.mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("skillDownloadMain", () => {
    it("should download and install skill to correct directory", async () => {
      // Mock config (no private registries)
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Mock getSkillPackument to return skill info
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify API was called with registry URL
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "test-skill",
        version: undefined,
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });

      // Verify skill was extracted to correct location
      const skillDir = path.join(skillsDir, "test-skill");
      const stats = await fs.stat(skillDir);
      expect(stats.isDirectory()).toBe(true);

      // Verify SKILL.md was extracted
      const skillMd = await fs.readFile(
        path.join(skillDir, "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("test-skill");

      // Verify success message
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("download");
      expect(allOutput).toContain("test-skill");

      // Verify .nori-version file was created
      const versionFilePath = path.join(skillDir, ".nori-version");
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

      // Mock getSkillPackument to return skill info
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "2.0.0" },
        versions: { "2.0.0": { name: "test-skill", version: "2.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "test-skill@2.0.0",
        cwd: testDir,
      });

      // Verify version was passed to API with registry URL
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "test-skill",
        version: "2.0.0",
        registryUrl: REGISTRAR_URL,
        authToken: undefined,
      });
    });

    it("should error when skill already exists without .nori-version", async () => {
      // Create existing skill directory without version file
      const existingSkillDir = path.join(skillsDir, "existing-skill");
      await fs.mkdir(existingSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(existingSkillDir, "SKILL.md"),
        "# Existing Skill",
      );

      await skillDownloadMain({
        skillSpec: "existing-skill",
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
        await skillDownloadMain({
          skillSpec: "test-skill",
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

    it("should handle download errors gracefully", async () => {
      vi.mocked(registrarApi.downloadSkillTarball).mockRejectedValue(
        new Error("Network error: Failed to fetch"),
      );

      await skillDownloadMain({
        skillSpec: "test-skill",
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
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "gzipped-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "gzipped-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball({ gzip: true });
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "gzipped-skill",
        cwd: testDir,
      });

      // Verify skill was extracted
      const skillDir = path.join(skillsDir, "gzipped-skill");
      const stats = await fs.stat(skillDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should use --install-dir option when provided", async () => {
      // Create a separate installation directory
      const customInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-custom-install-"),
      );
      const customSkillsDir = path.join(customInstallDir, ".claude", "skills");
      await fs.mkdir(customSkillsDir, { recursive: true });
      await fs.writeFile(
        path.join(customInstallDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: customInstallDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "custom-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "custom-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      try {
        await skillDownloadMain({
          skillSpec: "custom-skill",
          installDir: customInstallDir,
        });

        // Verify skill was installed to custom directory
        const skillDir = path.join(customSkillsDir, "custom-skill");
        const stats = await fs.stat(skillDir);
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

      // Skill only exists in public registry
      vi.mocked(registrarApi.getSkillPackument).mockImplementation(
        async (args) => {
          if (args.registryUrl === REGISTRAR_URL) {
            return {
              name: "test-skill",
              "dist-tags": { latest: "1.0.0" },
              versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
            };
          }
          throw new Error("Not found");
        },
      );

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify both registries were searched
      expect(registrarApi.getSkillPackument).toHaveBeenCalledWith({
        skillName: "test-skill",
        registryUrl: REGISTRAR_URL,
      });
      expect(registrarApi.getSkillPackument).toHaveBeenCalledWith({
        skillName: "test-skill",
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify download succeeded from public registry
      const skillDir = path.join(skillsDir, "test-skill");
      const stats = await fs.stat(skillDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should error with disambiguation when skill found in multiple registries", async () => {
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

      // Skill exists in BOTH registries
      vi.mocked(registrarApi.getSkillPackument).mockImplementation(
        async (args) => {
          if (args.registryUrl === REGISTRAR_URL) {
            return {
              name: "test-skill",
              description: "Public version",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": { name: "test-skill", version: "1.0.0" },
              } as Record<string, { name: string; version: string }>,
            };
          }
          if (args.registryUrl === privateRegistryUrl) {
            return {
              name: "test-skill",
              description: "Private version",
              "dist-tags": { latest: "2.0.0" },
              versions: {
                "2.0.0": { name: "test-skill", version: "2.0.0" },
              } as Record<string, { name: string; version: string }>,
            };
          }
          throw new Error("Not found");
        },
      );

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify error message about multiple skills
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("multiple");
      expect(allErrorOutput).toContain(REGISTRAR_URL);
      expect(allErrorOutput).toContain(privateRegistryUrl);
      expect(allErrorOutput).toContain("--registry");

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
    });

    it("should download from single registry when skill only in one", async () => {
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

      // Skill only exists in private registry
      vi.mocked(registrarApi.getSkillPackument).mockImplementation(
        async (args) => {
          if (args.registryUrl === privateRegistryUrl) {
            return {
              name: "private-skill",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": { name: "private-skill", version: "1.0.0" },
              },
            };
          }
          throw new Error("Not found");
        },
      );

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "private-skill",
        cwd: testDir,
      });

      // Verify download was from private registry with auth
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "private-skill",
        version: undefined,
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify skill was installed
      const skillDir = path.join(skillsDir, "private-skill");
      const stats = await fs.stat(skillDir);
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

      // Skill exists in public registry
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        registryUrl: REGISTRAR_URL,
      });

      // Verify only public registry was searched (no auth token)
      expect(registrarApi.getSkillPackument).toHaveBeenCalledTimes(1);
      expect(registrarApi.getSkillPackument).toHaveBeenCalledWith({
        skillName: "test-skill",
        registryUrl: REGISTRAR_URL,
      });

      // Verify download was from public registry
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "test-skill",
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

      // Skill exists in private registry
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "private-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "private-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "private-skill",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
      });

      // Verify only private registry was searched with auth
      expect(registrarApi.getSkillPackument).toHaveBeenCalledTimes(1);
      expect(registrarApi.getSkillPackument).toHaveBeenCalledWith({
        skillName: "private-skill",
        registryUrl: privateRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify download was from private registry with auth
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "private-skill",
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

      await skillDownloadMain({
        skillSpec: "private-skill",
        cwd: testDir,
        registryUrl: privateRegistryUrl,
      });

      // Verify error about no auth configured
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("auth");

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
    });

    it("should error when skill not found in any registry", async () => {
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

      // Skill not found in any registry
      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Not found"),
      );

      await skillDownloadMain({
        skillSpec: "nonexistent-skill",
        cwd: testDir,
      });

      // Verify error message about not found
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toContain("not found");

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
    });
  });

  describe("--list-versions flag", () => {
    it("should list available versions instead of downloading", async () => {
      // Skill exists in public registry with multiple versions
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "2.0.0", beta: "2.1.0-beta.1" },
        versions: {
          "1.0.0": { name: "test-skill", version: "1.0.0" },
          "1.1.0": { name: "test-skill", version: "1.1.0" },
          "2.0.0": { name: "test-skill", version: "2.0.0" },
          "2.1.0-beta.1": { name: "test-skill", version: "2.1.0-beta.1" },
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

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        listVersions: true,
      });

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();

      // Verify version list was displayed
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("test-skill");
      expect(allOutput).toContain("latest");
      expect(allOutput).toContain("2.0.0");
      expect(allOutput).toContain("1.0.0");
    });

    it("should error when skill not found with --list-versions", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getSkillPackument).mockRejectedValue(
        new Error("Not found"),
      );

      await skillDownloadMain({
        skillSpec: "nonexistent-skill",
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
    it("should update existing skill when newer version is available", async () => {
      // Create existing skill with old version
      const existingSkillDir = path.join(skillsDir, "test-skill");
      await fs.mkdir(existingSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(existingSkillDir, "SKILL.md"),
        "# Old version",
      );
      await fs.writeFile(
        path.join(existingSkillDir, ".nori-version"),
        JSON.stringify({ version: "1.0.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Registry has newer version
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-skill", version: "1.0.0" },
          "2.0.0": { name: "test-skill", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify download occurred
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalled();

      // Verify success message about update
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("updated");
    });

    it("should report when already at latest version", async () => {
      // Create existing skill with same version as latest
      const existingSkillDir = path.join(skillsDir, "test-skill");
      await fs.mkdir(existingSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(existingSkillDir, "SKILL.md"),
        "# Current version",
      );
      await fs.writeFile(
        path.join(existingSkillDir, ".nori-version"),
        JSON.stringify({ version: "1.0.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Registry has same version
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "test-skill", version: "1.0.0" },
        },
      });

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();

      // Verify message about already at version
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput.toLowerCase()).toContain("already");
    });

    it("should report when installed version is newer than requested", async () => {
      // Create existing skill with newer version
      const existingSkillDir = path.join(skillsDir, "test-skill");
      await fs.mkdir(existingSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(existingSkillDir, "SKILL.md"),
        "# Newer version",
      );
      await fs.writeFile(
        path.join(existingSkillDir, ".nori-version"),
        JSON.stringify({ version: "2.0.0", registryUrl: REGISTRAR_URL }),
      );

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      // Request older version
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "test-skill", version: "1.0.0" },
          "2.0.0": { name: "test-skill", version: "2.0.0" },
        },
      });

      await skillDownloadMain({
        skillSpec: "test-skill@1.0.0",
        cwd: testDir,
      });

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();

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

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Should not make any API calls
      expect(registrarApi.getSkillPackument).not.toHaveBeenCalled();
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();

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

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
      });

      // Should make API calls since claude-code is installed
      expect(registrarApi.getSkillPackument).toHaveBeenCalled();
    });
  });
});

/**
 * Creates a minimal mock skill tarball for testing
 * @param args - The tarball options
 * @param args.gzip - Whether to gzip the tarball (default: false)
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockSkillTarball = async (args?: {
  gzip?: boolean | null;
}): Promise<ArrayBuffer> => {
  const gzip = args?.gzip ?? false;
  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), "mock-skill-tarball-source-"),
  );
  const tarballPath = path.join(
    tmpdir(),
    `mock-skill-tarball-${Date.now()}.${gzip ? "tgz" : "tar"}`,
  );

  try {
    // Create mock skill files
    await fs.writeFile(
      path.join(tempDir, "SKILL.md"),
      `---
name: test-skill
description: A test skill
---

# test-skill

This is a test skill.
`,
    );

    // Create the tarball synchronously to avoid race condition
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
