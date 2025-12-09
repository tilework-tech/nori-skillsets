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

    it("should install nori-install-location.md slash command", async () => {
      const config: Config = { installDir: tempDir };

      await slashCommandsLoader.install({ config });

      // Verify nori-install-location.md exists
      const installLocationPath = path.join(
        commandsDir,
        "nori-install-location.md",
      );
      const exists = await fs
        .access(installLocationPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify file has content
      const content = await fs.readFile(installLocationPath, "utf-8");
      expect(content).toContain("description:");
      expect(content.length).toBeGreaterThan(0);
    });

    it("should install nori-install-location.md as hook-intercepted command", async () => {
      const config: Config = { installDir: tempDir };

      await slashCommandsLoader.install({ config });

      const installLocationPath = path.join(
        commandsDir,
        "nori-install-location.md",
      );
      const content = await fs.readFile(installLocationPath, "utf-8");

      // Hook-intercepted commands don't need allowed-tools since
      // they are executed directly by the hook without LLM processing
      expect(content).toContain("description:");
      expect(content).toContain("intercepted by a hook");
    });

    it("should include allowed-tools in nori-debug.md for auto-execute permission", async () => {
      const config: Config = { installDir: tempDir };

      await slashCommandsLoader.install({ config });

      const debugPath = path.join(commandsDir, "nori-debug.md");
      const content = await fs.readFile(debugPath, "utf-8");

      // Slash commands using !`command` syntax require allowed-tools frontmatter
      // to grant Claude Code permission to execute the command
      expect(content).toContain("allowed-tools:");
      expect(content).toContain("Bash(nori-ai");
    });

    it("should install nori-modify-registry-auth.md slash command", async () => {
      const config: Config = { installDir: tempDir };

      await slashCommandsLoader.install({ config });

      // Verify nori-modify-registry-auth.md exists
      const modifyRegistryAuthPath = path.join(
        commandsDir,
        "nori-modify-registry-auth.md",
      );
      const exists = await fs
        .access(modifyRegistryAuthPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify file has required frontmatter
      const content = await fs.readFile(modifyRegistryAuthPath, "utf-8");
      expect(content).toContain("description:");

      // Verify allowed-tools for config file operations
      expect(content).toContain("allowed-tools:");
      expect(content).toContain("Read(");
      expect(content).toContain("Write(");
      expect(content).toContain(".nori-config.json");
    });

    it("should install nori-modify-watchtower-auth.md slash command", async () => {
      const config: Config = { installDir: tempDir };

      await slashCommandsLoader.install({ config });

      // Verify nori-modify-watchtower-auth.md exists
      const modifyWatchtowerAuthPath = path.join(
        commandsDir,
        "nori-modify-watchtower-auth.md",
      );
      const exists = await fs
        .access(modifyWatchtowerAuthPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify file has required frontmatter
      const content = await fs.readFile(modifyWatchtowerAuthPath, "utf-8");
      expect(content).toContain("description:");

      // Verify allowed-tools for config file operations
      expect(content).toContain("allowed-tools:");
      expect(content).toContain("Read(");
      expect(content).toContain("Write(");
      expect(content).toContain(".nori-config.json");
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

  describe("template substitution", () => {
    it("should apply template substitution to slash command markdown files for custom install", async () => {
      // Create a custom install directory (not under home)
      const customInstallDir = path.join(tempDir, "custom-install", ".claude");
      await fs.mkdir(customInstallDir, { recursive: true });

      // Update mock paths for custom install
      mockClaudeDir = customInstallDir;
      mockClaudeCommandsDir = path.join(customInstallDir, "commands");

      const config: Config = {
        installDir: path.join(tempDir, "custom-install"),
      };

      // Run profiles loader for custom install (to set up composed profile)
      await profilesLoader.run({ config });
      await slashCommandsLoader.install({ config });

      // Check a slash command that uses {{profiles_dir}} placeholder
      // nori-create-profile.md should have placeholders substituted
      const createProfilePath = path.join(
        customInstallDir,
        "commands",
        "nori-create-profile.md",
      );
      const content = await fs.readFile(createProfilePath, "utf-8");

      // Should have template placeholders substituted with absolute paths
      expect(content).not.toContain("{{profiles_dir}}");
      expect(content).not.toContain("{{skills_dir}}");

      // For custom install, paths should be absolute (not tilde)
      // The profiles directory should NOT use tilde notation
      expect(content).not.toContain("~/.claude/profiles/");
      expect(content).toContain(
        path.join(tempDir, "custom-install", ".claude", "profiles"),
      );
    });

    it("should apply template substitution to slash command frontmatter allowed-tools", async () => {
      // Create a custom install directory (not under home)
      const customInstallDir = path.join(
        tempDir,
        "custom-install-2",
        ".claude",
      );
      await fs.mkdir(customInstallDir, { recursive: true });

      // Update mock paths for custom install
      mockClaudeDir = customInstallDir;
      mockClaudeCommandsDir = path.join(customInstallDir, "commands");

      const config: Config = {
        installDir: path.join(tempDir, "custom-install-2"),
      };

      // Run profiles loader for custom install
      await profilesLoader.run({ config });
      await slashCommandsLoader.install({ config });

      // Check nori-create-profile.md allowed-tools frontmatter
      const createProfilePath = path.join(
        customInstallDir,
        "commands",
        "nori-create-profile.md",
      );
      const content = await fs.readFile(createProfilePath, "utf-8");

      // The allowed-tools frontmatter should have absolute paths, not tilde
      // Extract the frontmatter (between --- markers)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();

      const frontmatter = frontmatterMatch![1];

      // Should NOT have tilde paths in frontmatter for custom install
      expect(frontmatter).not.toContain("~/.claude/profiles/");

      // Should have absolute path in frontmatter
      expect(frontmatter).toContain(
        path.join(tempDir, "custom-install-2", ".claude", "profiles"),
      );
    });
  });
});
