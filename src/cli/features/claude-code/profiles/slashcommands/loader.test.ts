/**
 * Tests for slash commands feature loader
 * Verifies install operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";
import type { SkillsetPackage } from "@/norijson/packageStructure.js";

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
 * Build a minimal SkillsetPackage with the given slashcommands
 *
 * @param args - Build arguments
 * @param args.slashcommands - Slash command entries to include
 *
 * @returns A SkillsetPackage with only slashcommands populated
 */
const buildPkg = (args: {
  slashcommands?: Array<{ filename: string; content: string }> | null;
}): SkillsetPackage => {
  const { slashcommands } = args;
  return {
    claudeMd: null,
    skills: [],
    subagents: [],
    slashcommands: slashcommands ?? [],
  };
};

// Standard test slash commands
const TEST_SLASH_COMMANDS = [
  {
    filename: "nori-init-docs.md",
    content: "# Init Docs\n\nInitialize documentation.\n",
  },
  {
    filename: "nori-create-profile.md",
    content:
      "# Create Profile\n\nCreate a new profile at {{profiles_dir}}/new.\n",
  },
];

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
    mockNoriDir = path.join(tempDir, ".nori");

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
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
      const pkg = buildPkg({ slashcommands: TEST_SLASH_COMMANDS });

      await slashCommandsLoader.install({ config, pkg });

      // Verify commands directory exists
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify slash command files were written
      const files = await fs.readdir(commandsDir);
      expect(files.length).toBe(2);

      // Should have the init docs command
      const hasInitDocs = files.includes("nori-init-docs.md");
      expect(hasInitDocs).toBe(true);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const pkg = buildPkg({ slashcommands: TEST_SLASH_COMMANDS });

      // First installation
      await slashCommandsLoader.install({ config, pkg });

      const firstFiles = await fs.readdir(commandsDir);
      expect(firstFiles.length).toBe(2);

      // Second installation (update)
      await slashCommandsLoader.install({ config, pkg });

      const secondFiles = await fs.readdir(commandsDir);
      expect(secondFiles.length).toBe(2);
    });
  });

  describe("template substitution", () => {
    it("should substitute template placeholders in slash command files", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const pkg = buildPkg({
        slashcommands: [
          {
            filename: "nori-create-profile.md",
            content: "Create a new profile at {{profiles_dir}}/new.\n",
          },
        ],
      });

      await slashCommandsLoader.install({ config, pkg });

      // Check the installed file
      const installedPath = path.join(commandsDir, "nori-create-profile.md");
      const content = await fs.readFile(installedPath, "utf-8");

      // Should have substituted {{profiles_dir}} with actual nori profiles path
      const expectedProfilesDir = path.join(tempDir, ".nori", "profiles");
      expect(content).toContain(expectedProfilesDir);
      expect(content).not.toContain("{{profiles_dir}}");
    });
  });

  describe("empty slashcommands", () => {
    it("should remove existing commands when pkg has no slashcommands", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First, install slashcommands
      const pkg = buildPkg({ slashcommands: TEST_SLASH_COMMANDS });
      await slashCommandsLoader.install({ config, pkg });

      // Verify commands were installed
      let files = await fs.readdir(commandsDir);
      expect(files.length).toBe(2);

      // Install again with empty slashcommands
      const emptyPkg = buildPkg({ slashcommands: [] });
      await slashCommandsLoader.install({ config, pkg: emptyPkg });

      // The commands directory should now be empty
      files = await fs.readdir(commandsDir);
      expect(files.length).toBe(0);
    });

    it("should handle empty slashcommands gracefully during install", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const pkg = buildPkg({ slashcommands: [] });

      // Install should not throw
      await expect(
        slashCommandsLoader.install({ config, pkg }),
      ).resolves.not.toThrow();

      // Commands directory should still be created
      const exists = await fs
        .access(commandsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
