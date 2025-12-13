/**
 * Tests for uninstall cleanup behavior
 * Verifies that uninstall properly cleans up all Nori-created files and directories
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock modules - initialize with temp values
let mockClaudeDir = "/tmp/test-claude";
let mockConfigPath = "/tmp/test-config.json";

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

vi.mock("@/cli/env.js", () => ({
  CLI_ROOT: "/mock/cli/root",
}));

let mockLoadedConfig: any = null;

vi.mock("@/cli/config.js", async () => {
  const actual: any = await vi.importActual("@/cli/config.js");
  return {
    ...actual,
    getConfigPath: () => mockConfigPath,
    loadConfig: async () => mockLoadedConfig,
  };
});

vi.mock("@/cli/analytics.js", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  newline: vi.fn(),
}));

// Import after mocking
import { profilesLoader } from "@/cli/features/claude-code/profiles/loader.js";
import { slashCommandsLoader } from "@/cli/features/claude-code/profiles/slashcommands/loader.js";
import { subagentsLoader } from "@/cli/features/claude-code/profiles/subagents/loader.js";

import { runUninstall } from "./uninstall.js";

describe("uninstall cleanup", () => {
  let tempDir: string;
  let claudeDir: string;
  let agentsDir: string;
  let commandsDir: string;
  let profilesDir: string;
  let configPath: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd;

    // Create temp directory for testing
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "uninstall-cleanup-test-"),
    );
    claudeDir = path.join(tempDir, ".claude");
    agentsDir = path.join(claudeDir, "agents");
    commandsDir = path.join(claudeDir, "commands");
    profilesDir = path.join(claudeDir, "profiles");
    configPath = path.join(tempDir, ".nori-config.json");

    // CRITICAL: Mock cwd to point to temp directory
    process.cwd = () => tempDir;

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockConfigPath = configPath;

    // Set mock config with agents field for loaders
    mockLoadedConfig = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
    };

    // Create base claude directory
    await fs.mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Restore original cwd
    process.cwd = originalCwd;

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("uninstall order", () => {
    it("should uninstall subagents before profiles removes profile directories", async () => {
      // Set up free config
      const config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install profiles first (creates ~/.claude/profiles/senior-swe/subagents/)
      await profilesLoader.run({ config });

      // Install subagents (copies files to ~/.claude/agents/)
      await subagentsLoader.install({ config });

      // Verify agents were installed
      const agentFiles = await fs.readdir(agentsDir);
      expect(agentFiles.length).toBeGreaterThan(0);

      // Run full uninstall
      await runUninstall({
        removeGlobalSettings: true,
        installDir: tempDir,
      });

      // Verify all agent files are removed
      // The directory might still exist but should be empty or removed
      const agentsDirExists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      if (agentsDirExists) {
        const remainingFiles = await fs.readdir(agentsDir);
        const noriFiles = remainingFiles.filter((f) => f.startsWith("nori-"));
        expect(noriFiles.length).toBe(0);
      }
    });

    it("should uninstall slash commands before profiles removes profile directories", async () => {
      // Set up free config
      const config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install profiles first (creates ~/.claude/profiles/senior-swe/slashcommands/)
      await profilesLoader.run({ config });

      // Install slash commands (copies files to ~/.claude/commands/)
      await slashCommandsLoader.install({ config });

      // Verify commands were installed
      const commandFiles = await fs.readdir(commandsDir);
      expect(commandFiles.length).toBeGreaterThan(0);

      // Run full uninstall
      await runUninstall({
        removeGlobalSettings: true,
        installDir: tempDir,
      });

      // Verify all command files are removed
      const commandsDirExists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      if (commandsDirExists) {
        const remainingFiles = await fs.readdir(commandsDir);
        const noriFiles = remainingFiles.filter(
          (f) =>
            f.endsWith(".md") &&
            (f.includes("nori") ||
              f.includes("switch-") ||
              f.includes("sync-") ||
              f.includes("initialize-")),
        );
        expect(noriFiles.length).toBe(0);
      }
    });
  });

  describe("directory cleanup", () => {
    it.each([
      {
        dir: "agents",
        dirPath: "agentsDir",
        installFn: async (config: any) => {
          await profilesLoader.run({ config });
          await subagentsLoader.install({ config });
        },
      },
      {
        dir: "commands",
        dirPath: "commandsDir",
        installFn: async (config: any) => {
          await profilesLoader.run({ config });
          await slashCommandsLoader.install({ config });
        },
      },
      {
        dir: "profiles",
        dirPath: "profilesDir",
        installFn: async (config: any) => {
          await profilesLoader.run({ config });
        },
      },
    ])(
      "should remove empty $dir directory after uninstall",
      async ({ dirPath, installFn }) => {
        const config = {
          installDir: tempDir,
          agents: {
            "claude-code": { profile: { baseProfile: "senior-swe" } },
          },
        };
        const targetDir =
          dirPath === "agentsDir"
            ? agentsDir
            : dirPath === "commandsDir"
              ? commandsDir
              : profilesDir;

        // Install
        await installFn(config);

        // Verify directory exists with files
        const files = await fs.readdir(targetDir);
        expect(files.length).toBeGreaterThan(0);

        // Run full uninstall
        await runUninstall({
          removeGlobalSettings: true,
          installDir: tempDir,
        });

        // Verify directory is removed
        const dirExists = await fs
          .access(targetDir)
          .then(() => true)
          .catch(() => false);

        expect(dirExists).toBe(false);
      },
    );

    it("should preserve directories with user-created files", async () => {
      // Set up free config
      const config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install profiles and subagents
      await profilesLoader.run({ config });
      await subagentsLoader.install({ config });

      // Create a user file in agents directory
      const userAgentFile = path.join(agentsDir, "my-custom-agent.md");
      await fs.writeFile(userAgentFile, "# My Custom Agent");

      // Run full uninstall
      await runUninstall({
        removeGlobalSettings: true,
        installDir: tempDir,
      });

      // Verify agents directory still exists (has user file)
      const agentsDirExists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      expect(agentsDirExists).toBe(true);

      // Verify user file is preserved
      const userFileExists = await fs
        .access(userAgentFile)
        .then(() => true)
        .catch(() => false);

      expect(userFileExists).toBe(true);
    });
  });

  describe("legacy notifications log cleanup", () => {
    it("should remove legacy .nori-notifications.log file during uninstall", async () => {
      // Create legacy notifications log file (from older versions)
      const logPath = path.join(tempDir, ".nori-notifications.log");
      await fs.writeFile(logPath, "test notification log content");

      // Verify file exists
      const logExistsBefore = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);
      expect(logExistsBefore).toBe(true);

      // Run uninstall
      await runUninstall({
        removeGlobalSettings: true,
        installDir: tempDir,
      });

      // Verify file is removed
      const logExistsAfter = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);

      expect(logExistsAfter).toBe(false);
    });

    it("should handle missing notifications log gracefully", async () => {
      // Don't create the log file - it shouldn't exist

      // Run uninstall - should not throw
      await expect(
        runUninstall({ removeGlobalSettings: true, installDir: tempDir }),
      ).resolves.not.toThrow();
    });
  });
});
