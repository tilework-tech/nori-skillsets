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

vi.mock("@/installer/env.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

let mockLoadedConfig: any = null;

vi.mock("@/installer/config.js", async () => {
  const actual: any = await vi.importActual("@/installer/config.js");
  return {
    ...actual,
    getConfigPath: () => mockConfigPath,
    loadDiskConfig: async () => mockLoadedConfig,
  };
});

vi.mock("@/installer/analytics.js", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/installer/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Import after mocking
import { profilesLoader } from "@/installer/features/profiles/loader.js";
import { slashCommandsLoader } from "@/installer/features/slashcommands/loader.js";
import { subagentsLoader } from "@/installer/features/subagents/loader.js";

import { runUninstall } from "./uninstall.js";

describe("uninstall cleanup", () => {
  let tempDir: string;
  let claudeDir: string;
  let agentsDir: string;
  let commandsDir: string;
  let profilesDir: string;
  let configPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Save original HOME
    originalHome = process.env.HOME;

    // Create temp directory for testing
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "uninstall-cleanup-test-"),
    );
    claudeDir = path.join(tempDir, ".claude");
    agentsDir = path.join(claudeDir, "agents");
    commandsDir = path.join(claudeDir, "commands");
    profilesDir = path.join(claudeDir, "profiles");
    configPath = path.join(tempDir, "nori-config.json");

    // CRITICAL: Mock HOME to point to temp directory
    process.env.HOME = tempDir;

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockConfigPath = configPath;

    // Reset mock config
    mockLoadedConfig = null;

    // Create base claude directory
    await fs.mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("uninstall order", () => {
    it("should uninstall subagents before profiles removes profile directories", async () => {
      // Set up free config
      const config = { installType: "free" as const };

      // Install profiles first (creates ~/.claude/profiles/senior-swe/subagents/)
      await profilesLoader.run({ config });

      // Install subagents (copies files to ~/.claude/agents/)
      await subagentsLoader.run({ config });

      // Verify agents were installed
      const agentFiles = await fs.readdir(agentsDir);
      expect(agentFiles.length).toBeGreaterThan(0);

      // Run full uninstall
      await runUninstall();

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
      const config = { installType: "free" as const };

      // Install profiles first (creates ~/.claude/profiles/senior-swe/slashcommands/)
      await profilesLoader.run({ config });

      // Install slash commands (copies files to ~/.claude/commands/)
      await slashCommandsLoader.run({ config });

      // Verify commands were installed
      const commandFiles = await fs.readdir(commandsDir);
      expect(commandFiles.length).toBeGreaterThan(0);

      // Run full uninstall
      await runUninstall();

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
    it("should remove empty agents directory after uninstall", async () => {
      // Set up free config
      const config = { installType: "free" as const };

      // Install profiles and subagents
      await profilesLoader.run({ config });
      await subagentsLoader.run({ config });

      // Verify agents directory exists with files
      const agentFiles = await fs.readdir(agentsDir);
      expect(agentFiles.length).toBeGreaterThan(0);

      // Run full uninstall
      await runUninstall();

      // Verify agents directory is removed (since it should be empty)
      const agentsDirExists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      expect(agentsDirExists).toBe(false);
    });

    it("should remove empty commands directory after uninstall", async () => {
      // Set up free config
      const config = { installType: "free" as const };

      // Install profiles and slash commands
      await profilesLoader.run({ config });
      await slashCommandsLoader.run({ config });

      // Verify commands directory exists with files
      const commandFiles = await fs.readdir(commandsDir);
      expect(commandFiles.length).toBeGreaterThan(0);

      // Run full uninstall
      await runUninstall();

      // Verify commands directory is removed (since it should be empty)
      const commandsDirExists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      expect(commandsDirExists).toBe(false);
    });

    it("should remove empty profiles directory after uninstall", async () => {
      // Set up free config
      const config = { installType: "free" as const };

      // Install profiles
      await profilesLoader.run({ config });

      // Verify profiles directory exists with files
      const profileFiles = await fs.readdir(profilesDir);
      expect(profileFiles.length).toBeGreaterThan(0);

      // Run full uninstall
      await runUninstall();

      // Verify profiles directory is removed (since it should be empty)
      const profilesDirExists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);

      expect(profilesDirExists).toBe(false);
    });

    it("should preserve directories with user-created files", async () => {
      // Set up free config
      const config = { installType: "free" as const };

      // Install profiles and subagents
      await profilesLoader.run({ config });
      await subagentsLoader.run({ config });

      // Create a user file in agents directory
      const userAgentFile = path.join(agentsDir, "my-custom-agent.md");
      await fs.writeFile(userAgentFile, "# My Custom Agent");

      // Run full uninstall
      await runUninstall();

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

  describe("notifications log cleanup", () => {
    it("should remove .nori-notifications.log file during uninstall", async () => {
      // Create notifications log file
      const logPath = path.join(tempDir, ".nori-notifications.log");
      await fs.writeFile(logPath, "test notification log content");

      // Verify file exists
      const logExistsBefore = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);
      expect(logExistsBefore).toBe(true);

      // Run uninstall
      await runUninstall();

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
      await expect(runUninstall()).resolves.not.toThrow();
    });
  });
});
