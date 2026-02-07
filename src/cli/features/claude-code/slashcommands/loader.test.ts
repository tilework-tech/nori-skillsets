/**
 * Tests for global slash commands feature loader
 *
 * Global slash commands have been removed - this loader is now a no-op.
 * These tests verify the no-op behavior is correct.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeHomeDir: string;
let mockClaudeHomeCommandsDir: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude"),
  getClaudeSettingsFile: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "settings.json"),
  getClaudeAgentsDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "agents"),
  getClaudeCommandsDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "commands"),
  getClaudeMdFile: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "CLAUDE.md"),
  getClaudeSkillsDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "skills"),
  getClaudeProfilesDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "profiles"),
  getNoriDir: () => path.join(os.homedir(), ".nori"),
  getNoriProfilesDir: () => path.join(os.homedir(), ".nori", "profiles"),
  getNoriConfigFile: () => path.join(os.homedir(), ".nori", "config.json"),
  getClaudeHomeDir: () => mockClaudeHomeDir,
  getClaudeHomeSettingsFile: () =>
    path.join(mockClaudeHomeDir, "settings.json"),
  getClaudeHomeCommandsDir: () => mockClaudeHomeCommandsDir,
}));

// Import loader after mocking env
import { globalSlashCommandsLoader } from "./loader.js";

describe("globalSlashCommandsLoader", () => {
  let tempDir: string;
  let homeDir: string;
  let claudeHomeDir: string;
  let commandsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "global-slashcmd-test-"));
    homeDir = path.join(tempDir, "home");
    claudeHomeDir = path.join(homeDir, ".claude");
    commandsDir = path.join(claudeHomeDir, "commands");

    // Set mock paths
    mockClaudeHomeDir = claudeHomeDir;
    mockClaudeHomeCommandsDir = commandsDir;

    // Create directories
    await fs.mkdir(claudeHomeDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("loader metadata", () => {
    it("should have name 'slashcommands'", () => {
      expect(globalSlashCommandsLoader.name).toBe("slashcommands");
    });

    it("should have a description", () => {
      expect(globalSlashCommandsLoader.description).toBeDefined();
      expect(globalSlashCommandsLoader.description.length).toBeGreaterThan(0);
    });
  });

  describe("run (install)", () => {
    it("should be a no-op and not create commands directory", async () => {
      const config: Config = { installDir: tempDir };

      await globalSlashCommandsLoader.run({ config });

      // Commands directory should NOT be created since no commands exist
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(false);
    });

    it("should not throw errors", async () => {
      const config: Config = { installDir: tempDir };

      await expect(
        globalSlashCommandsLoader.run({ config }),
      ).resolves.not.toThrow();
    });
  });
});
