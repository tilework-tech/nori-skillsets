/**
 * Tests for slash commands feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeCommandsDir: string;
let mockNoriDir: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => mockClaudeCommandsDir,
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  getNoriDir: () => mockNoriDir,
  getNoriProfilesDir: () => path.join(mockNoriDir, "profiles"),
  getNoriConfigFile: () => path.join(mockNoriDir, "config.json"),
}));

// Import loaders after mocking env
import { slashCommandsLoader } from "./loader.js";

/**
 * Create a stub profile directory with CLAUDE.md and optional slashcommands
 *
 * @param args - Function arguments
 * @param args.profilesDir - Path to the profiles directory
 * @param args.profileName - Name of the profile
 * @param args.slashcommands - Optional map of command filename to content
 */
const createStubProfile = async (args: {
  profilesDir: string;
  profileName: string;
  slashcommands?: Record<string, string> | null;
}): Promise<void> => {
  const { profilesDir, profileName, slashcommands } = args;
  const profileDir = path.join(profilesDir, profileName);
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile\n");

  if (slashcommands != null) {
    const cmdDir = path.join(profileDir, "slashcommands");
    await fs.mkdir(cmdDir, { recursive: true });
    for (const [filename, content] of Object.entries(slashcommands)) {
      await fs.writeFile(path.join(cmdDir, filename), content);
    }
  }
};

// Standard test slash commands
const TEST_SLASH_COMMANDS: Record<string, string> = {
  "nori-init-docs.md": "# Init Docs\n\nInitialize documentation.\n",
  "nori-create-profile.md":
    "# Create Profile\n\nCreate a new profile at {{profiles_dir}}/new.\n",
};

describe("slashCommandsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let commandsDir: string;
  let noriProfilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "slashcmd-test-"));
    claudeDir = path.join(tempDir, ".claude");
    commandsDir = path.join(claudeDir, "commands");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeCommandsDir = commandsDir;
    mockNoriDir = path.join(tempDir, ".nori");
    noriProfilesDir = path.join(mockNoriDir, "profiles");

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriProfilesDir, { recursive: true });

    // Create stub profile with test slash commands
    await createStubProfile({
      profilesDir: noriProfilesDir,
      profileName: "senior-swe",
      slashcommands: TEST_SLASH_COMMANDS,
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create commands directory and copy slash command files", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

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

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

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
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

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
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Uninstall without installing first
      await expect(
        slashCommandsLoader.uninstall({ config }),
      ).resolves.not.toThrow();
    });
  });

  // Validate tests removed - validation is now handled at profilesLoader level

  // Note: Template substitution tests for global commands (like nori-create-profile.md)
  // have been moved to src/cli/features/claude-code/slashcommands/loader.test.ts
  // Profile-specific slash commands (nori-init-docs) may not use template substitution

  describe("missing profile slashcommands directory", () => {
    it("should remove existing commands when switching to profile without slashcommands", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First, install slashcommands from a profile that has them
      await slashCommandsLoader.install({ config });

      // Verify commands were installed
      let files = await fs.readdir(commandsDir);
      expect(files.length).toBeGreaterThan(0);

      // Now remove the slashcommands directory from the profile to simulate
      // switching to a profile without slashcommands
      const profileSlashCommandsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "slashcommands",
      );
      await fs.rm(profileSlashCommandsDir, { recursive: true, force: true });

      // Install again (simulating profile switch)
      await slashCommandsLoader.install({ config });

      // The commands directory should now be empty since the profile has no slashcommands
      files = await fs.readdir(commandsDir);
      expect(files.length).toBe(0);
    });

    it("should handle missing slashcommands directory gracefully during install", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Remove the slashcommands directory from the installed profile
      const profileSlashCommandsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "slashcommands",
      );
      await fs.rm(profileSlashCommandsDir, { recursive: true, force: true });

      // Install should not throw
      await expect(
        slashCommandsLoader.install({ config }),
      ).resolves.not.toThrow();

      // Commands directory should still be created
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should return valid when profile slashcommands directory is missing during validate", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First install to create commands directory
      await slashCommandsLoader.install({ config });

      // Remove the slashcommands directory from the installed profile
      const profileSlashCommandsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "slashcommands",
      );
      await fs.rm(profileSlashCommandsDir, { recursive: true, force: true });

      // Validate should return valid:true (0 commands expected)
      if (slashCommandsLoader.validate == null) {
        throw new Error("validate method not implemented");
      }
      const result = await slashCommandsLoader.validate({ config });
      expect(result.valid).toBe(true);
    });
  });
});
