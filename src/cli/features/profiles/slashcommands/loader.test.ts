/**
 * Tests for slash commands feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { profilesLoader } from "@/cli/features/profiles/loader.js";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeCommandsDir: string;

vi.mock("@/cli/env.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => mockClaudeCommandsDir,
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

// Import loaders after mocking env
import { slashCommandsLoader } from "./loader.js";

describe("slashCommandsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let commandsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "slashcmd-test-"));
    claudeDir = path.join(tempDir, ".claude");
    commandsDir = path.join(claudeDir, "commands");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeCommandsDir = commandsDir;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });

    // Install profiles first to set up composed profile structure
    // Run profiles loader to populate ~/.claude/profiles/ directory
    // This is required since feature loaders now read from ~/.claude/profiles/
    const config: Config = { installDir: tempDir };
    await profilesLoader.run({ config });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create commands directory and copy slash command files for free installation", async () => {
      const config: Config = { installDir: tempDir };

      await slashCommandsLoader.install({ config });

      // Verify commands directory exists
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify at least one command file was copied (based on SLASH_COMMANDS config in loader)
      const files = await fs.readdir(commandsDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it("should create commands directory and copy slash command files for paid installation", async () => {
      const config: Config = {
        installDir: tempDir,
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
      };

      await slashCommandsLoader.install({ config });

      // Verify commands directory exists
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify at least one command file was copied
      const files = await fs.readdir(commandsDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = { installDir: tempDir };

      // First installation
      await slashCommandsLoader.install({ config });

      const firstFiles = await fs.readdir(commandsDir);
      expect(firstFiles.length).toBeGreaterThan(0);

      // Second installation (update)
      await slashCommandsLoader.install({ config });

      const secondFiles = await fs.readdir(commandsDir);
      expect(secondFiles.length).toBeGreaterThan(0);
    });
  });

  describe("uninstall", () => {
    it("should remove slash command files", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await slashCommandsLoader.install({ config });

      // Verify files exist
      let files = await fs.readdir(commandsDir);
      expect(files.length).toBeGreaterThan(0);

      // Uninstall
      await slashCommandsLoader.uninstall({ config });

      // Verify files are removed (or directory is empty/gone)
      // The loader removes individual files, not the directory
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        files = await fs.readdir(commandsDir);
        // All nori slash commands should be removed
        // Check that no .md files remain
        const mdFiles = files.filter((f) => f.endsWith(".md"));
        expect(mdFiles.length).toBe(0);
      }
    });

    it("should handle missing commands directory gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Uninstall without installing first
      await expect(
        slashCommandsLoader.uninstall({ config }),
      ).resolves.not.toThrow();
    });
  });

  // Validate tests removed - validation is now handled at profilesLoader level

  // Note: Template substitution tests for global commands (like nori-create-profile.md)
  // have been moved to src/cli/features/slashcommands/loader.test.ts
  // Profile-specific slash commands (nori-init-docs, nori-sync-docs) may not use template substitution
});
