/**
 * Tests for cursor-agent slash commands feature loader
 * Verifies install, uninstall, and validate operations for slash commands
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the paths module to use temp directories
// These represent the HOME directory paths (global)
let mockCursorHomeDir: string;
let mockCursorHomeCommandsDir: string;

vi.mock("@/cli/features/cursor-agent/paths.js", () => ({
  // Project-relative paths (not used by slash commands loader after fix)
  getCursorDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".cursor"),
  getCursorCommandsDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".cursor", "commands"),
  getCursorProfilesDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".cursor", "profiles"),
  getCursorRulesDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".cursor", "rules"),
  getCursorAgentsMdFile: (args: { installDir: string }) =>
    path.join(args.installDir, "AGENTS.md"),
  // Home-based paths (used by slash commands loader after fix)
  getCursorHomeDir: () => mockCursorHomeDir,
  getCursorHomeCommandsDir: () => mockCursorHomeCommandsDir,
}));

// Import loader after mocking
import { cursorSlashCommandsLoader } from "./loader.js";

describe("cursorSlashCommandsLoader", () => {
  let tempDir: string;
  let homeDir: string;
  let cursorHomeDir: string;
  let commandsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-slashcmd-test-"));
    // Simulate home directory (separate from installDir)
    homeDir = path.join(tempDir, "home");
    cursorHomeDir = path.join(homeDir, ".cursor");
    commandsDir = path.join(cursorHomeDir, "commands");

    // Set mock paths - commands go to HOME directory, not installDir
    mockCursorHomeDir = cursorHomeDir;
    mockCursorHomeCommandsDir = commandsDir;

    // Create directories
    await fs.mkdir(cursorHomeDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("loader metadata", () => {
    it("should have name 'slashcommands'", () => {
      expect(cursorSlashCommandsLoader.name).toBe("slashcommands");
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

    it("should install nori-info.md slash command", async () => {
      const config: Config = { installDir: tempDir };

      await cursorSlashCommandsLoader.run({ config });

      const infoPath = path.join(commandsDir, "nori-info.md");
      const exists = await fs
        .access(infoPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      const content = await fs.readFile(infoPath, "utf-8");
      expect(content).toContain("description:");
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
    it("should remove all slash command files", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await cursorSlashCommandsLoader.run({ config });

      // Get list of installed files
      const installedFiles = await fs.readdir(commandsDir);
      const installedMdFiles = installedFiles.filter((f) => f.endsWith(".md"));
      expect(installedMdFiles.length).toBeGreaterThan(0);

      // Uninstall
      await cursorSlashCommandsLoader.uninstall({ config });

      // Verify slash command files are removed
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const remainingFiles = await fs.readdir(commandsDir);
        // All installed slash commands should be removed
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

    it("should preserve non-managed slash command files", async () => {
      const config: Config = { installDir: tempDir };

      // Install commands
      await cursorSlashCommandsLoader.run({ config });

      // Add a custom non-managed slash command
      const customCommandPath = path.join(commandsDir, "my-custom-command.md");
      await fs.writeFile(customCommandPath, "# Custom command\nThis is custom");

      // Uninstall commands
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
      await fs.unlink(path.join(commandsDir, "nori-info.md"));

      // Validate
      const result = await cursorSlashCommandsLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.message).toContain("missing");
    });
  });
});
