/**
 * Tests for Cursor slash commands feature loader
 * Verifies install, uninstall, and validate operations for Cursor slash commands
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockCursorDir: string;
let mockCursorCommandsDir: string;

vi.mock("@/cli/env.js", () => ({
  getCursorDir: () => mockCursorDir,
  getCursorSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  getCursorHomeDir: () => mockCursorDir,
  getCursorHomeSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  getCursorCommandsDir: () => mockCursorCommandsDir,
  getCursorProfilesDir: () => path.join(mockCursorDir, "profiles"),
  // Also mock Claude paths for any shared code
  getClaudeDir: () => mockCursorDir,
  getClaudeSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  getClaudeHomeDir: () => mockCursorDir,
  getClaudeHomeSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockCursorDir, "agents"),
  getClaudeCommandsDir: () => mockCursorCommandsDir,
  getClaudeMdFile: () => path.join(mockCursorDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockCursorDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockCursorDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

// Import loader after mocking env
import { cursorSlashCommandsLoader } from "./loader.js";

describe("cursorSlashCommandsLoader", () => {
  let tempDir: string;
  let cursorDir: string;
  let commandsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-slashcmd-test-"));
    cursorDir = path.join(tempDir, ".cursor");
    commandsDir = path.join(cursorDir, "commands");

    // Set mock paths
    mockCursorDir = cursorDir;
    mockCursorCommandsDir = commandsDir;

    // Create directories
    await fs.mkdir(cursorDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("loader metadata", () => {
    it("should have name 'cursor-slashcommands'", () => {
      expect(cursorSlashCommandsLoader.name).toBe("cursor-slashcommands");
    });

    it("should have a description", () => {
      expect(cursorSlashCommandsLoader.description).toBeDefined();
      expect(cursorSlashCommandsLoader.description.length).toBeGreaterThan(0);
    });
  });

  describe("run (install)", () => {
    it("should create commands directory and copy slash command files", async () => {
      const config: Config = { installDir: tempDir };

      await cursorSlashCommandsLoader.run({ config });

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

      await cursorSlashCommandsLoader.run({ config });

      const files = await fs.readdir(commandsDir);
      const mdFiles = files.filter((f) => f.endsWith(".md"));

      // Should install at least the known essential commands
      expect(mdFiles.length).toBeGreaterThan(5);
      expect(mdFiles).toContain("nori-debug.md");
      expect(mdFiles).toContain("nori-switch-profile.md");
    });

    it("should install nori-debug.md slash command", async () => {
      const config: Config = { installDir: tempDir };

      await cursorSlashCommandsLoader.run({ config });

      const debugPath = path.join(commandsDir, "nori-debug.md");
      const exists = await fs
        .access(debugPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      const content = await fs.readFile(debugPath, "utf-8");
      expect(content).toContain("description:");
    });

    it("should apply template substitution to slash command files", async () => {
      const config: Config = { installDir: tempDir };

      await cursorSlashCommandsLoader.run({ config });

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
      await cursorSlashCommandsLoader.run({ config });

      const firstFiles = await fs.readdir(commandsDir);
      expect(firstFiles.length).toBeGreaterThan(0);

      // Second installation (update)
      await cursorSlashCommandsLoader.run({ config });

      const secondFiles = await fs.readdir(commandsDir);
      expect(secondFiles.length).toBeGreaterThan(0);
      expect(secondFiles.length).toBe(firstFiles.length);
    });
  });

  describe("uninstall", () => {
    it("should remove all Nori slash command files", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await cursorSlashCommandsLoader.run({ config });

      // Get list of installed files
      const installedFiles = await fs.readdir(commandsDir);
      const installedMdFiles = installedFiles.filter((f) => f.endsWith(".md"));
      expect(installedMdFiles.length).toBeGreaterThan(0);

      // Uninstall
      await cursorSlashCommandsLoader.uninstall({ config });

      // Verify Nori slash command files are removed
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const remainingFiles = await fs.readdir(commandsDir);
        // All installed Nori slash commands should be removed
        for (const cmd of installedMdFiles) {
          expect(remainingFiles).not.toContain(cmd);
        }
      }
    });

    it("should handle missing commands directory gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Uninstall without installing first
      await expect(
        cursorSlashCommandsLoader.uninstall({ config }),
      ).resolves.not.toThrow();
    });

    it("should preserve non-Nori slash command files", async () => {
      const config: Config = { installDir: tempDir };

      // Install Nori commands
      await cursorSlashCommandsLoader.run({ config });

      // Add a custom non-Nori slash command
      const customCommandPath = path.join(commandsDir, "my-custom-command.md");
      await fs.writeFile(customCommandPath, "# Custom command\nThis is custom");

      // Uninstall Nori commands
      await cursorSlashCommandsLoader.uninstall({ config });

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
      await cursorSlashCommandsLoader.run({ config });

      // Validate
      const result = await cursorSlashCommandsLoader.validate!({ config });

      expect(result.valid).toBe(true);
    });

    it("should return invalid when commands directory does not exist", async () => {
      const config: Config = { installDir: tempDir };

      // Don't install - commands directory doesn't exist

      // Validate
      const result = await cursorSlashCommandsLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should return invalid when some commands are missing", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await cursorSlashCommandsLoader.run({ config });

      // Remove one command
      await fs.unlink(path.join(commandsDir, "nori-debug.md"));

      // Validate
      const result = await cursorSlashCommandsLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.message).toContain("missing");
    });
  });
});
