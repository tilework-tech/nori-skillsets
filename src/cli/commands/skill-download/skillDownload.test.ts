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
    getAgentProfile: (args: {
      config: {
        agents?: Record<
          string,
          { profile?: { baseProfile: string } | null } | null
        > | null;
      };
      agentName: string;
    }) => {
      const agentConfig = args.config.agents?.[args.agentName];
      return agentConfig?.profile ?? null;
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

    it("should download skill without prior Nori installation", async () => {
      // Create directory WITHOUT .nori-config.json
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );
      const noInstallSkillsDir = path.join(noInstallDir, ".claude", "skills");

      try {
        // Mock config returns null (no config file exists)
        vi.mocked(loadConfig).mockResolvedValue(null);

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
          cwd: noInstallDir,
        });

        // Verify skill was installed (directory should be created)
        const skillDir = path.join(noInstallSkillsDir, "test-skill");
        const stats = await fs.stat(skillDir);
        expect(stats.isDirectory()).toBe(true);

        // Verify SKILL.md was extracted
        const skillMd = await fs.readFile(
          path.join(skillDir, "SKILL.md"),
          "utf-8",
        );
        expect(skillMd).toContain("test-skill");

        // Verify .nori-version file was created
        const versionFilePath = path.join(skillDir, ".nori-version");
        const versionFileContent = await fs.readFile(versionFilePath, "utf-8");
        const versionInfo = JSON.parse(versionFileContent);
        expect(versionInfo.version).toBe("1.0.0");
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });

    it("should create .claude/skills directory if it does not exist", async () => {
      // Create directory WITHOUT .nori-config.json and WITHOUT .claude/skills
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );
      const noInstallSkillsDir = path.join(noInstallDir, ".claude", "skills");

      try {
        // Verify skills directory does not exist initially
        await expect(fs.access(noInstallSkillsDir)).rejects.toThrow();

        vi.mocked(loadConfig).mockResolvedValue(null);

        vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
          name: "new-skill",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "new-skill", version: "1.0.0" } },
        });

        const mockTarball = await createMockSkillTarball();
        vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
          mockTarball,
        );

        await skillDownloadMain({
          skillSpec: "new-skill",
          cwd: noInstallDir,
        });

        // Verify skills directory was created
        const skillsDirStats = await fs.stat(noInstallSkillsDir);
        expect(skillsDirStats.isDirectory()).toBe(true);

        // Verify skill was installed
        const skillDir = path.join(noInstallSkillsDir, "new-skill");
        const skillDirStats = await fs.stat(skillDir);
        expect(skillDirStats.isDirectory()).toBe(true);
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

  describe("cliName in user-facing messages", () => {
    it("should use nori-skillsets command names when cliName is nori-skillsets", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
      });

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        listVersions: true,
        cliName: "nori-skillsets",
      });

      // Verify version hint uses nori-skillsets command names
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("nori-skillsets download-skill");
      expect(allOutput).not.toContain("nori-ai skill-download");
    });

    it("should use nori-ai command names when cliName is nori-ai", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
      });

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "test-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
      });

      await skillDownloadMain({
        skillSpec: "test-skill",
        cwd: testDir,
        listVersions: true,
        cliName: "nori-ai",
      });

      // Verify version hint uses nori-ai command names
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("nori-ai skill-download");
      expect(allOutput).not.toContain("nori-skillsets download-skill");
    });
  });
});

describe("--skillset option and manifest updates", () => {
  let testDir: string;
  let skillsDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-skillset-test-"));
    skillsDir = path.join(testDir, ".claude", "skills");
    profilesDir = path.join(testDir, ".nori", "profiles");

    // Create directories
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });

    // Create a test profile with CLAUDE.md
    const testProfileDir = path.join(profilesDir, "test-profile");
    await fs.mkdir(testProfileDir, { recursive: true });
    await fs.writeFile(
      path.join(testProfileDir, "CLAUDE.md"),
      "# Test Profile",
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should add skill to specified skillset's skills.json", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "other-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
      skillset: "test-profile",
    });

    // Verify skill was downloaded
    const skillDir = path.join(skillsDir, "test-skill");
    const stats = await fs.stat(skillDir);
    expect(stats.isDirectory()).toBe(true);

    // Verify skill was added to the specified profile's skills.json
    const skillsJsonPath = path.join(
      profilesDir,
      "test-profile",
      "skills.json",
    );
    const skillsJsonContent = await fs.readFile(skillsJsonPath, "utf-8");
    const skillsJson = JSON.parse(skillsJsonContent);
    expect(skillsJson["test-skill"]).toBe("*");
  });

  it("should add skill to active profile's skills.json when --skillset not specified", async () => {
    // Create active profile directory
    const activeProfileDir = path.join(profilesDir, "active-profile");
    await fs.mkdir(activeProfileDir, { recursive: true });
    await fs.writeFile(
      path.join(activeProfileDir, "CLAUDE.md"),
      "# Active Profile",
    );

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "active-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "new-skill",
      "dist-tags": { latest: "2.0.0" },
      versions: { "2.0.0": { name: "new-skill", version: "2.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "new-skill",
      cwd: testDir,
    });

    // Verify skill was added to active profile's skills.json
    const skillsJsonPath = path.join(
      profilesDir,
      "active-profile",
      "skills.json",
    );
    const skillsJsonContent = await fs.readFile(skillsJsonPath, "utf-8");
    const skillsJson = JSON.parse(skillsJsonContent);
    expect(skillsJson["new-skill"]).toBe("*");
  });

  it("should error when specified skillset does not exist", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
      skillset: "nonexistent-profile",
    });

    // Verify error message about profile not found
    const allErrorOutput = mockConsoleError.mock.calls
      .map((call) => call.join(" "))
      .join("\n");
    expect(allErrorOutput.toLowerCase()).toContain("not found");
    expect(allErrorOutput).toContain("nonexistent-profile");

    // Verify no download occurred
    expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
  });

  it("should skip manifest update when no active profile and --skillset not specified", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      // No agents/profile configured
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
    });

    // Verify skill was still downloaded
    const skillDir = path.join(skillsDir, "test-skill");
    const stats = await fs.stat(skillDir);
    expect(stats.isDirectory()).toBe(true);

    // Verify info message about skipping manifest update
    const allOutput = mockConsoleLog.mock.calls
      .map((call) => call.join(" "))
      .join("\n");
    expect(allOutput.toLowerCase()).toMatch(/no.*profile|no.*skillset/i);
  });

  it("should not update manifest when --list-versions flag is used", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "test-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
      listVersions: true,
    });

    // Verify no skills.json was created
    const skillsJsonPath = path.join(
      profilesDir,
      "test-profile",
      "skills.json",
    );
    await expect(fs.access(skillsJsonPath)).rejects.toThrow();
  });

  it("should add skill to specified skillset when cliName is nori-skillsets", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "other-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
      skillset: "test-profile",
      cliName: "nori-skillsets",
    });

    // Verify skill was downloaded to live location
    const skillDir = path.join(skillsDir, "test-skill");
    const stats = await fs.stat(skillDir);
    expect(stats.isDirectory()).toBe(true);

    // Verify skill was persisted to the specified profile's skills directory
    const profileSkillDir = path.join(
      profilesDir,
      "test-profile",
      "skills",
      "test-skill",
    );
    const profileStats = await fs.stat(profileSkillDir);
    expect(profileStats.isDirectory()).toBe(true);

    // Verify manifest was updated
    const skillsJsonPath = path.join(
      profilesDir,
      "test-profile",
      "skills.json",
    );
    const skillsJsonContent = await fs.readFile(skillsJsonPath, "utf-8");
    const skillsJson = JSON.parse(skillsJsonContent);
    expect(skillsJson["test-skill"]).toBe("*");

    // Verify nori-skillsets-specific messaging
    const allOutput = mockConsoleLog.mock.calls
      .map((call) => call.join(" "))
      .join("\n");
    expect(allOutput).toContain("test-profile");
  });

  it("should update existing skills.json preserving other entries", async () => {
    // Create profile with existing skills.json
    const existingSkillsJson = {
      "existing-skill": "^1.0.0",
      "another-skill": "*",
    };
    await fs.writeFile(
      path.join(profilesDir, "test-profile", "skills.json"),
      JSON.stringify(existingSkillsJson),
    );

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "test-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "new-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "new-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "new-skill",
      cwd: testDir,
      skillset: "test-profile",
    });

    // Verify skills.json has both old and new entries
    const skillsJsonPath = path.join(
      profilesDir,
      "test-profile",
      "skills.json",
    );
    const skillsJsonContent = await fs.readFile(skillsJsonPath, "utf-8");
    const skillsJson = JSON.parse(skillsJsonContent);

    expect(skillsJson).toEqual({
      "existing-skill": "^1.0.0",
      "another-skill": "*",
      "new-skill": "*",
    });
  });
});

describe("profile directory persistence", () => {
  let testDir: string;
  let skillsDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-profile-persist-test-"),
    );
    skillsDir = path.join(testDir, ".claude", "skills");
    profilesDir = path.join(testDir, ".nori", "profiles");

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });

    // Create active profile directory with CLAUDE.md
    const activeProfileDir = path.join(profilesDir, "active-profile");
    await fs.mkdir(activeProfileDir, { recursive: true });
    await fs.writeFile(
      path.join(activeProfileDir, "CLAUDE.md"),
      "# Active Profile",
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should copy downloaded skill to active profile's skills directory", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "active-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
    });

    // Verify skill exists in the live location (~/.claude/skills/)
    const liveSkillDir = path.join(skillsDir, "test-skill");
    const liveStats = await fs.stat(liveSkillDir);
    expect(liveStats.isDirectory()).toBe(true);

    // Verify skill also exists in the profile's skills directory
    const profileSkillDir = path.join(
      profilesDir,
      "active-profile",
      "skills",
      "test-skill",
    );
    const profileStats = await fs.stat(profileSkillDir);
    expect(profileStats.isDirectory()).toBe(true);

    // Verify SKILL.md was copied to profile
    const profileSkillMd = await fs.readFile(
      path.join(profileSkillDir, "SKILL.md"),
      "utf-8",
    );
    expect(profileSkillMd).toContain("test-skill");

    // Verify .nori-version was written to profile copy
    const profileVersionFile = path.join(profileSkillDir, ".nori-version");
    const profileVersionContent = await fs.readFile(
      profileVersionFile,
      "utf-8",
    );
    const profileVersionInfo = JSON.parse(profileVersionContent);
    expect(profileVersionInfo.version).toBe("1.0.0");
    expect(profileVersionInfo.registryUrl).toBe(REGISTRAR_URL);
  });

  it("should copy skill to specified skillset's skills directory when --skillset used", async () => {
    // Create specified profile
    const specifiedProfileDir = path.join(profilesDir, "specified-profile");
    await fs.mkdir(specifiedProfileDir, { recursive: true });
    await fs.writeFile(
      path.join(specifiedProfileDir, "CLAUDE.md"),
      "# Specified Profile",
    );

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "active-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
      skillset: "specified-profile",
    });

    // Verify skill exists in the specified profile's skills directory
    const profileSkillDir = path.join(
      profilesDir,
      "specified-profile",
      "skills",
      "test-skill",
    );
    const profileStats = await fs.stat(profileSkillDir);
    expect(profileStats.isDirectory()).toBe(true);

    const profileSkillMd = await fs.readFile(
      path.join(profileSkillDir, "SKILL.md"),
      "utf-8",
    );
    expect(profileSkillMd).toContain("test-skill");
  });

  it("should not crash when no active profile and no --skillset", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      // No agents/profile configured
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
    });

    // Verify skill was still downloaded to live location
    const liveSkillDir = path.join(skillsDir, "test-skill");
    const liveStats = await fs.stat(liveSkillDir);
    expect(liveStats.isDirectory()).toBe(true);

    // Verify no profile copy was attempted (no crash)
    // No profile skills directory should exist for any profile
    const activeProfileSkillsDir = path.join(
      profilesDir,
      "active-profile",
      "skills",
    );
    const exists = await fs
      .access(activeProfileSkillsDir)
      .then(() => true)
      .catch(() => false);
    // It might or might not exist (the profile dir was created in beforeEach)
    // but the skill should NOT be there
    if (exists) {
      const skillExists = await fs
        .access(path.join(activeProfileSkillsDir, "test-skill"))
        .then(() => true)
        .catch(() => false);
      expect(skillExists).toBe(false);
    }
  });

  it("should create profile skills directory if it does not exist", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "active-profile" },
        },
      },
    });

    // Verify no skills/ subdirectory exists in the profile yet
    const profileSkillsDir = path.join(profilesDir, "active-profile", "skills");
    const dirExistsBefore = await fs
      .access(profileSkillsDir)
      .then(() => true)
      .catch(() => false);
    expect(dirExistsBefore).toBe(false);

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name: "test-skill", version: "1.0.0" } },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
    });

    // Verify profile skills directory was created
    const dirExistsAfter = await fs
      .access(profileSkillsDir)
      .then(() => true)
      .catch(() => false);
    expect(dirExistsAfter).toBe(true);

    // Verify skill was copied there
    const profileSkillMd = path.join(
      profileSkillsDir,
      "test-skill",
      "SKILL.md",
    );
    const skillMdContent = await fs.readFile(profileSkillMd, "utf-8");
    expect(skillMdContent).toContain("test-skill");
  });

  it("should update profile copy when updating an existing skill", async () => {
    // Create existing skill in live location with old version
    const existingLiveDir = path.join(skillsDir, "test-skill");
    await fs.mkdir(existingLiveDir, { recursive: true });
    await fs.writeFile(path.join(existingLiveDir, "SKILL.md"), "# Old version");
    await fs.writeFile(
      path.join(existingLiveDir, ".nori-version"),
      JSON.stringify({ version: "1.0.0", registryUrl: REGISTRAR_URL }),
    );

    // Create existing skill in profile with old version
    const existingProfileDir = path.join(
      profilesDir,
      "active-profile",
      "skills",
      "test-skill",
    );
    await fs.mkdir(existingProfileDir, { recursive: true });
    await fs.writeFile(
      path.join(existingProfileDir, "SKILL.md"),
      "# Old version",
    );
    await fs.writeFile(
      path.join(existingProfileDir, ".nori-version"),
      JSON.stringify({ version: "1.0.0", registryUrl: REGISTRAR_URL }),
    );

    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "active-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "test-skill",
      "dist-tags": { latest: "2.0.0" },
      versions: {
        "1.0.0": { name: "test-skill", version: "1.0.0" },
        "2.0.0": { name: "test-skill", version: "2.0.0" },
      },
    });

    const mockTarball = await createMockSkillTarball();
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "test-skill",
      cwd: testDir,
    });

    // Verify profile copy was updated
    const profileVersionFile = path.join(existingProfileDir, ".nori-version");
    const profileVersionContent = await fs.readFile(
      profileVersionFile,
      "utf-8",
    );
    const profileVersionInfo = JSON.parse(profileVersionContent);
    expect(profileVersionInfo.version).toBe("2.0.0");
  });

  it("should store raw files in profile and apply template substitution to live copy", async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      installDir: testDir,
      registryAuths: [],
      agents: {
        "claude-code": {
          profile: { baseProfile: "active-profile" },
        },
      },
    });

    vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
      name: "templated-skill",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": { name: "templated-skill", version: "1.0.0" },
      },
    });

    const mockTarball = await createMockSkillTarball({
      skillContent: `---
name: templated-skill
description: A skill with templates
---

# templated-skill

Skills directory: {{skills_dir}}
Install directory: {{install_dir}}
`,
    });
    vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(mockTarball);

    await skillDownloadMain({
      skillSpec: "templated-skill",
      cwd: testDir,
    });

    // Profile copy should have RAW template variables (no substitution)
    const profileSkillMd = await fs.readFile(
      path.join(
        profilesDir,
        "active-profile",
        "skills",
        "templated-skill",
        "SKILL.md",
      ),
      "utf-8",
    );
    expect(profileSkillMd).toContain("{{skills_dir}}");
    expect(profileSkillMd).toContain("{{install_dir}}");

    // Live copy should have substituted template variables
    const liveSkillMd = await fs.readFile(
      path.join(skillsDir, "templated-skill", "SKILL.md"),
      "utf-8",
    );
    expect(liveSkillMd).not.toContain("{{skills_dir}}");
    expect(liveSkillMd).not.toContain("{{install_dir}}");
    // Verify the substituted paths are correct
    expect(liveSkillMd).toContain(path.join(testDir, ".claude", "skills"));
    expect(liveSkillMd).toContain(testDir);
  });
});

describe("namespaced package support", () => {
  let testDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test directory structure simulating a Nori installation
    testDir = await fs.mkdtemp(path.join(tmpdir(), "nori-namespace-test-"));
    skillsDir = path.join(testDir, ".claude", "skills");

    // Create initial config
    await fs.writeFile(
      path.join(testDir, ".nori-config.json"),
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

  describe("namespace parsing", () => {
    it("should parse org/skill-name format and download from org registry", async () => {
      const orgRegistryUrl = "https://myorg.noriskillsets.dev";

      // Mock config with unified auth
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
        auth: {
          username: "testuser",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "test-refresh-token",
          organizations: ["myorg", "public"],
        },
      });

      // Mock auth token
      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      // Skill exists in org registry
      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "my-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "my-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "myorg/my-skill",
        cwd: testDir,
      });

      // Verify API was called with org registry URL
      expect(registrarApi.getSkillPackument).toHaveBeenCalledWith({
        skillName: "my-skill",
        registryUrl: orgRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify download was from org registry
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "my-skill",
        version: undefined,
        registryUrl: orgRegistryUrl,
        authToken: "mock-auth-token",
      });

      // Verify skill was installed to FLAT directory (not nested by org)
      const skillDir = path.join(skillsDir, "my-skill");
      const stats = await fs.stat(skillDir);
      expect(stats.isDirectory()).toBe(true);

      // Verify .nori-version includes orgId
      const versionFilePath = path.join(skillDir, ".nori-version");
      const versionFileContent = await fs.readFile(versionFilePath, "utf-8");
      const versionInfo = JSON.parse(versionFileContent);
      expect(versionInfo.orgId).toBe("myorg");
      expect(versionInfo.version).toBe("1.0.0");
      expect(versionInfo.registryUrl).toBe(orgRegistryUrl);
    });

    it("should parse org/skill-name@version format", async () => {
      const orgRegistryUrl = "https://myorg.noriskillsets.dev";

      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
        auth: {
          username: "testuser",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "test-refresh-token",
          organizations: ["myorg", "public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "my-skill",
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { name: "my-skill", version: "1.0.0" },
          "2.0.0": { name: "my-skill", version: "2.0.0" },
        },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "myorg/my-skill@1.0.0",
        cwd: testDir,
      });

      // Verify download was called with specific version
      expect(registrarApi.downloadSkillTarball).toHaveBeenCalledWith({
        skillName: "my-skill",
        version: "1.0.0",
        registryUrl: orgRegistryUrl,
        authToken: "mock-auth-token",
      });
    });
  });

  describe("unified auth and org access", () => {
    it("should error when user does not have access to org", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
        auth: {
          username: "testuser",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "test-refresh-token",
          organizations: ["other-org", "public"], // Does NOT include "myorg"
        },
      });

      await skillDownloadMain({
        skillSpec: "myorg/my-skill",
        cwd: testDir,
      });

      // Verify error message about no access to org
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput).toContain("myorg");
      expect(allErrorOutput.toLowerCase()).toContain("access");

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
    });
  });

  describe("namespace and --registry conflict", () => {
    it("should error when namespace is specified with --registry flag", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
        auth: {
          username: "testuser",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "test-refresh-token",
          organizations: ["myorg", "public"],
        },
      });

      await skillDownloadMain({
        skillSpec: "myorg/my-skill",
        registryUrl: "https://other.registry.com",
        cwd: testDir,
      });

      // Verify error about conflicting options
      const allErrorOutput = mockConsoleError.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allErrorOutput.toLowerCase()).toMatch(
        /namespace.*registry|registry.*namespace|cannot.*both/i,
      );

      // Verify no download occurred
      expect(registrarApi.downloadSkillTarball).not.toHaveBeenCalled();
    });
  });

  describe("display names in messages", () => {
    it("should show namespaced format in success messages", async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        installDir: testDir,
        registryAuths: [],
        auth: {
          username: "testuser",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "test-refresh-token",
          organizations: ["myorg", "public"],
        },
      });

      vi.mocked(getRegistryAuthToken).mockResolvedValue("mock-auth-token");

      vi.mocked(registrarApi.getSkillPackument).mockResolvedValue({
        name: "my-skill",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "my-skill", version: "1.0.0" } },
      });

      const mockTarball = await createMockSkillTarball();
      vi.mocked(registrarApi.downloadSkillTarball).mockResolvedValue(
        mockTarball,
      );

      await skillDownloadMain({
        skillSpec: "myorg/my-skill",
        cwd: testDir,
      });

      // Verify success message includes namespaced format
      const allOutput = mockConsoleLog.mock.calls
        .map((call) => call.join(" "))
        .join("\n");
      expect(allOutput).toContain("myorg/my-skill");
    });
  });
});

/**
 * Creates a minimal mock skill tarball for testing
 * @param args - The tarball options
 * @param args.gzip - Whether to gzip the tarball (default: false)
 * @param args.skillContent - Optional custom SKILL.md content
 *
 * @returns A valid tarball as ArrayBuffer
 */
const createMockSkillTarball = async (args?: {
  gzip?: boolean | null;
  skillContent?: string | null;
}): Promise<ArrayBuffer> => {
  const gzip = args?.gzip ?? false;
  const skillContent =
    args?.skillContent ??
    `---
name: test-skill
description: A test skill
---

# test-skill

This is a test skill.
`;
  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), "mock-skill-tarball-source-"),
  );
  const tarballPath = path.join(
    tmpdir(),
    `mock-skill-tarball-${Date.now()}.${gzip ? "tgz" : "tar"}`,
  );

  try {
    // Create mock skill files
    await fs.writeFile(path.join(tempDir, "SKILL.md"), skillContent);

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
