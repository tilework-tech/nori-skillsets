/**
 * Tests for global slash commands feature loader
 * Verifies install, uninstall, and validate operations for profile-agnostic slash commands
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeCommandsDir: string;

vi.mock("@/cli/env.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => mockClaudeCommandsDir,
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

// Import loader after mocking env
import { globalSlashCommandsLoader } from "./loader.js";

describe("globalSlashCommandsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let commandsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "global-slashcmd-test-"));
    claudeDir = path.join(tempDir, ".claude");
    commandsDir = path.join(claudeDir, "commands");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeCommandsDir = commandsDir;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
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
    it("should create commands directory and copy slash command files", async () => {
      const config: Config = { installDir: tempDir };

      await globalSlashCommandsLoader.run({ config });

      // Verify commands directory exists
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify slash command files were copied
      const files = await fs.readdir(commandsDir);
      const mdFiles = files.filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThan(0);
    });

    it("should install all global slash commands from config directory", async () => {
      const config: Config = { installDir: tempDir };

      await globalSlashCommandsLoader.run({ config });

      const files = await fs.readdir(commandsDir);
      const mdFiles = files.filter((f) => f.endsWith(".md"));

      // Should install at least the known essential commands
      expect(mdFiles.length).toBeGreaterThan(5);
      expect(mdFiles).toContain("nori-debug.md");
      expect(mdFiles).toContain("nori-switch-profile.md");
    });

    it("should install nori-debug.md slash command", async () => {
      const config: Config = { installDir: tempDir };

      await globalSlashCommandsLoader.run({ config });

      const debugPath = path.join(commandsDir, "nori-debug.md");
      const exists = await fs
        .access(debugPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      const content = await fs.readFile(debugPath, "utf-8");
      expect(content).toContain("description:");
    });

    it("should install nori-toggle-session-transcripts.md slash command", async () => {
      const config: Config = { installDir: tempDir };

      await globalSlashCommandsLoader.run({ config });

      const transcriptsPath = path.join(
        commandsDir,
        "nori-toggle-session-transcripts.md",
      );
      const exists = await fs
        .access(transcriptsPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      const content = await fs.readFile(transcriptsPath, "utf-8");
      expect(content).toContain("description:");
    });

    it("should apply template substitution to slash command files", async () => {
      const config: Config = { installDir: tempDir };

      await globalSlashCommandsLoader.run({ config });

      // Check nori-create-profile.md which uses {{profiles_dir}} placeholder
      const createProfilePath = path.join(
        commandsDir,
        "nori-create-profile.md",
      );
      const content = await fs.readFile(createProfilePath, "utf-8");

      // Should NOT contain template placeholders
      expect(content).not.toContain("{{profiles_dir}}");
      expect(content).not.toContain("{{skills_dir}}");
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = { installDir: tempDir };

      // First installation
      await globalSlashCommandsLoader.run({ config });

      const firstFiles = await fs.readdir(commandsDir);
      expect(firstFiles.length).toBeGreaterThan(0);

      // Second installation (update)
      await globalSlashCommandsLoader.run({ config });

      const secondFiles = await fs.readdir(commandsDir);
      expect(secondFiles.length).toBeGreaterThan(0);
      expect(secondFiles.length).toBe(firstFiles.length);
    });
  });

  describe("uninstall", () => {
    it("should remove all global slash command files", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await globalSlashCommandsLoader.run({ config });

      // Get list of installed files
      const installedFiles = await fs.readdir(commandsDir);
      const installedMdFiles = installedFiles.filter((f) => f.endsWith(".md"));
      expect(installedMdFiles.length).toBeGreaterThan(0);

      // Uninstall
      await globalSlashCommandsLoader.uninstall({ config });

      // Verify global slash command files are removed
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const remainingFiles = await fs.readdir(commandsDir);
        // All installed global slash commands should be removed
        for (const cmd of installedMdFiles) {
          expect(remainingFiles).not.toContain(cmd);
        }
      }
    });

    it("should handle missing commands directory gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Uninstall without installing first
      await expect(
        globalSlashCommandsLoader.uninstall({ config }),
      ).resolves.not.toThrow();
    });

    it("should preserve non-global slash command files", async () => {
      const config: Config = { installDir: tempDir };

      // Install global commands
      await globalSlashCommandsLoader.run({ config });

      // Add a custom non-global slash command
      const customCommandPath = path.join(commandsDir, "my-custom-command.md");
      await fs.writeFile(customCommandPath, "# Custom command\nThis is custom");

      // Uninstall global commands
      await globalSlashCommandsLoader.uninstall({ config });

      // Verify custom command is preserved
      const customExists = await fs
        .access(customCommandPath)
        .then(() => true)
        .catch(() => false);

      expect(customExists).toBe(true);
    });
  });

  describe("validate", () => {
    it("should return valid when all commands are installed", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await globalSlashCommandsLoader.run({ config });

      // Validate
      const result = await globalSlashCommandsLoader.validate!({ config });

      expect(result.valid).toBe(true);
    });

    it("should return invalid when commands directory does not exist", async () => {
      const config: Config = { installDir: tempDir };

      // Don't install - commands directory doesn't exist

      // Validate
      const result = await globalSlashCommandsLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should return invalid when some commands are missing", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await globalSlashCommandsLoader.run({ config });

      // Remove one command
      await fs.unlink(path.join(commandsDir, "nori-debug.md"));

      // Validate
      const result = await globalSlashCommandsLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.message).toContain("missing");
    });
  });
});
