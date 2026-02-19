/**
 * Tests for subagents feature loader
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
let mockClaudeAgentsDir: string;
let mockNoriDir: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => mockClaudeAgentsDir,
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  getNoriDir: () => mockNoriDir,
  getNoriProfilesDir: () => path.join(mockNoriDir, "profiles"),
  getNoriConfigFile: () => path.join(mockNoriDir, "config.json"),
}));

// Import loaders after mocking env
import { subagentsLoader } from "./loader.js";

/**
 * Build a minimal SkillsetPackage with the given subagents
 *
 * @param args - Function arguments
 * @param args.subagents - Subagent entries to include in the package
 *
 * @returns A SkillsetPackage for use in tests
 */
const buildPkg = (args: {
  subagents?: Array<{ filename: string; content: string }> | null;
}): SkillsetPackage => {
  const { subagents } = args;
  return {
    claudeMd: null,
    skills: [],
    subagents: subagents ?? [],
    slashcommands: [],
  };
};

// Standard test subagents
const TEST_SUBAGENTS = [
  {
    filename: "nori-codebase-analyzer.md",
    content:
      "# Codebase Analyzer\n\nAnalyze codebase.\nRead: `{{skills_dir}}/some-skill/SKILL.md`\n",
  },
  {
    filename: "nori-web-search-researcher.md",
    content: "# Web Search Researcher\n\nResearch on the web.\n",
  },
];

describe("subagentsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagents-test-"));
    claudeDir = path.join(tempDir, ".claude");
    agentsDir = path.join(claudeDir, "agents");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeAgentsDir = agentsDir;
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
    it("should create agents directory and copy subagent files", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const pkg = buildPkg({ subagents: TEST_SUBAGENTS });

      await subagentsLoader.install({ config, pkg });

      // Verify agents directory exists
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify subagent files were written
      const files = await fs.readdir(agentsDir);
      expect(files.length).toBe(2);

      // Should have the codebase analyzer subagent
      const hasCodebaseAnalyzer = files.includes("nori-codebase-analyzer.md");
      expect(hasCodebaseAnalyzer).toBe(true);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const pkg = buildPkg({ subagents: TEST_SUBAGENTS });

      // First installation
      await subagentsLoader.install({ config, pkg });

      const firstFiles = await fs.readdir(agentsDir);
      expect(firstFiles.length).toBe(2);

      // Second installation (update)
      await subagentsLoader.install({ config, pkg });

      const secondFiles = await fs.readdir(agentsDir);
      expect(secondFiles.length).toBe(2);
    });
  });

  describe("template substitution", () => {
    it("should substitute template placeholders in subagent files", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const pkg = buildPkg({
        subagents: [
          {
            filename: "nori-test-agent.md",
            content: "Read: `{{skills_dir}}/some-skill/SKILL.md`",
          },
        ],
      });

      await subagentsLoader.install({ config, pkg });

      // Check the installed file
      const installedPath = path.join(agentsDir, "nori-test-agent.md");
      const content = await fs.readFile(installedPath, "utf-8");

      // Should have substituted {{skills_dir}} with actual path
      const expectedSkillsDir = path.join(claudeDir, "skills");
      expect(content).toContain(expectedSkillsDir);
      expect(content).not.toContain("{{skills_dir}}");
    });
  });

  describe("empty subagents", () => {
    it("should remove existing agents when pkg has no subagents", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First, install subagents
      const pkg = buildPkg({ subagents: TEST_SUBAGENTS });
      await subagentsLoader.install({ config, pkg });

      // Verify agents were installed
      let files = await fs.readdir(agentsDir);
      expect(files.length).toBe(2);

      // Install again with empty subagents
      const emptyPkg = buildPkg({ subagents: [] });
      await subagentsLoader.install({ config, pkg: emptyPkg });

      // The agents directory should now be empty
      files = await fs.readdir(agentsDir);
      expect(files.length).toBe(0);
    });

    it("should handle empty subagents gracefully during install", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const pkg = buildPkg({ subagents: [] });

      // Install should not throw
      await expect(
        subagentsLoader.install({ config, pkg }),
      ).resolves.not.toThrow();

      // Agents directory should still be created
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
