/**
 * Tests for subagents feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

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
 * Create a stub profile directory with CLAUDE.md and optional subagents
 *
 * @param args - Function arguments
 * @param args.profilesDir - Path to the profiles directory
 * @param args.profileName - Name of the profile
 * @param args.subagents - Optional map of subagent filename to content
 */
const createStubProfile = async (args: {
  profilesDir: string;
  profileName: string;
  subagents?: Record<string, string> | null;
}): Promise<void> => {
  const { profilesDir, profileName, subagents } = args;
  const profileDir = path.join(profilesDir, profileName);
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile\n");

  if (subagents != null && Object.keys(subagents).length > 0) {
    const subagentsDir = path.join(profileDir, "subagents");
    await fs.mkdir(subagentsDir, { recursive: true });
    for (const [filename, content] of Object.entries(subagents)) {
      await fs.writeFile(path.join(subagentsDir, filename), content);
    }
  }
};

// Standard test subagents
const TEST_SUBAGENTS: Record<string, string> = {
  "nori-codebase-analyzer.md":
    "# Codebase Analyzer\n\nAnalyze codebase.\nRead: `{{skills_dir}}/some-skill/SKILL.md`\n",
  "nori-web-search-researcher.md":
    "# Web Search Researcher\n\nResearch on the web.\n",
};

describe("subagentsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let agentsDir: string;
  let noriProfilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagents-test-"));
    claudeDir = path.join(tempDir, ".claude");
    agentsDir = path.join(claudeDir, "agents");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeAgentsDir = agentsDir;
    mockNoriDir = path.join(tempDir, ".nori");
    noriProfilesDir = path.join(mockNoriDir, "profiles");

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriProfilesDir, { recursive: true });

    // Create stub profile with test subagents
    await createStubProfile({
      profilesDir: noriProfilesDir,
      profileName: "senior-swe",
      subagents: TEST_SUBAGENTS,
    });
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

      await subagentsLoader.install({ config });

      // Verify agents directory exists
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify at least one subagent file was copied
      const files = await fs.readdir(agentsDir);
      expect(files.length).toBeGreaterThan(0);

      // Should have common subagents like nori-codebase-analyzer
      const fileNames = await fs.readdir(agentsDir);
      const hasCodebaseAnalyzer = fileNames.includes(
        "nori-codebase-analyzer.md",
      );
      expect(hasCodebaseAnalyzer).toBe(true);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First installation
      await subagentsLoader.install({ config });

      const firstFiles = await fs.readdir(agentsDir);
      expect(firstFiles.length).toBeGreaterThan(0);

      // Second installation (update)
      await subagentsLoader.install({ config });

      const secondFiles = await fs.readdir(agentsDir);
      expect(secondFiles.length).toBeGreaterThan(0);
    });
  });

  describe("uninstall", () => {
    it("should remove subagent files", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install first
      await subagentsLoader.install({ config });

      // Verify files exist
      let files = await fs.readdir(agentsDir);
      const initialCount = files.length;
      expect(initialCount).toBeGreaterThan(0);

      // Uninstall
      await subagentsLoader.uninstall({ config });

      // Verify nori subagent files are removed
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        files = await fs.readdir(agentsDir);
        // Should have removed the nori-codebase-analyzer and other subagents
        const hasCodebaseAnalyzer = files.includes("nori-codebase-analyzer.md");
        expect(hasCodebaseAnalyzer).toBe(false);
      }
    });

    it("should handle missing agents directory gracefully", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Uninstall without installing first
      await expect(
        subagentsLoader.uninstall({ config }),
      ).resolves.not.toThrow();
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

      // Get a subagent file from the profile directory and add a template placeholder
      const profileSubagentsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "subagents",
      );
      const files = await fs.readdir(profileSubagentsDir);
      const mdFile = files.find((f) => f.endsWith(".md") && f !== "docs.md");

      // Ensure we actually have a subagent file to test with
      expect(mdFile).toBeDefined();

      if (mdFile) {
        // Add template placeholder to the file
        const subagentPath = path.join(profileSubagentsDir, mdFile);
        await fs.writeFile(
          subagentPath,
          "Read: `{{skills_dir}}/some-skill/SKILL.md`",
        );

        await subagentsLoader.install({ config });

        // Check the installed file
        const installedPath = path.join(agentsDir, mdFile);
        const content = await fs.readFile(installedPath, "utf-8");

        // Should have substituted {{skills_dir}} with actual path
        const expectedSkillsDir = path.join(claudeDir, "skills");
        expect(content).toContain(expectedSkillsDir);
        expect(content).not.toContain("{{skills_dir}}");
      }
    });
  });

  // Validate tests removed - validation is now handled at profilesLoader level

  describe("missing profile subagents directory", () => {
    it("should remove existing agents when switching to profile without subagents", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First, install subagents from a profile that has them
      await subagentsLoader.install({ config });

      // Verify agents were installed
      let files = await fs.readdir(agentsDir);
      expect(files.length).toBeGreaterThan(0);

      // Now remove the subagents directory from the profile to simulate
      // switching to a profile without subagents
      const profileSubagentsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "subagents",
      );
      await fs.rm(profileSubagentsDir, { recursive: true, force: true });

      // Install again (simulating profile switch)
      await subagentsLoader.install({ config });

      // The agents directory should now be empty since the profile has no subagents
      files = await fs.readdir(agentsDir);
      expect(files.length).toBe(0);
    });

    it("should handle missing subagents directory gracefully during install", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Remove the subagents directory from the installed profile
      const profileSubagentsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "subagents",
      );
      await fs.rm(profileSubagentsDir, { recursive: true, force: true });

      // Install should not throw
      await expect(subagentsLoader.install({ config })).resolves.not.toThrow();

      // Agents directory should still be created
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should return valid when profile subagents directory is missing during validate", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First install to create agents directory
      await subagentsLoader.install({ config });

      // Remove the subagents directory from the installed profile
      const profileSubagentsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "subagents",
      );
      await fs.rm(profileSubagentsDir, { recursive: true, force: true });

      // Validate should return valid:true (0 subagents expected)
      if (subagentsLoader.validate == null) {
        throw new Error("validate method not implemented");
      }
      const result = await subagentsLoader.validate({ config });
      expect(result.valid).toBe(true);
    });
  });
});
