/**
 * Tests for subagents feature loader
 * Verifies install operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { parseSkillset } from "@/cli/features/skillset.js";

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
  getClaudeSkillsetsDir: () => path.join(mockClaudeDir, "profiles"),
}));

vi.mock("@/cli/features/paths.js", () => ({
  getNoriDir: () => mockNoriDir,
  getNoriSkillsetsDir: () => path.join(mockNoriDir, "profiles"),
}));

// Import loaders after mocking env
import { subagentsLoader } from "./loader.js";

/**
 * Create a stub profile directory with nori.json and optional subagents
 *
 * @param args - Function arguments
 * @param args.skillsetsDir - Path to the profiles directory
 * @param args.skillsetName - Name of the profile
 * @param args.subagents - Optional map of subagent filename to content
 */
const createStubProfile = async (args: {
  skillsetsDir: string;
  skillsetName: string;
  subagents?: Record<string, string> | null;
}): Promise<void> => {
  const { skillsetsDir, skillsetName, subagents } = args;
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({ name: "Test Profile", version: "1.0.0" }),
  );

  if (subagents != null && Object.keys(subagents).length > 0) {
    const subagentsDir = path.join(skillsetDir, "subagents");
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
      skillsetsDir: noriProfilesDir,
      skillsetName: "senior-swe",
      subagents: TEST_SUBAGENTS,
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  /**
   * Helper to install with parsed skillset
   * @param args - Function arguments
   * @param args.config - Nori config with activeSkillset set
   */
  const installWithSkillset = async (args: { config: Config }) => {
    const { config } = args;
    const skillset = await parseSkillset({
      skillsetName: config.activeSkillset!,
    });
    await subagentsLoader.install({ config, skillset });
  };

  describe("run", () => {
    it("should create agents directory and copy subagent files", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
      };

      await installWithSkillset({ config });

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
        activeSkillset: "senior-swe",
      };

      // First installation
      await installWithSkillset({ config });

      const firstFiles = await fs.readdir(agentsDir);
      expect(firstFiles.length).toBeGreaterThan(0);

      // Second installation (update)
      await installWithSkillset({ config });

      const secondFiles = await fs.readdir(agentsDir);
      expect(secondFiles.length).toBeGreaterThan(0);
    });
  });

  describe("template substitution", () => {
    it("should substitute template placeholders in subagent files", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
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

        await installWithSkillset({ config });

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
        activeSkillset: "senior-swe",
      };

      // First, install subagents from a profile that has them
      await installWithSkillset({ config });

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
      await installWithSkillset({ config });

      // The agents directory should now be empty since the profile has no subagents
      files = await fs.readdir(agentsDir);
      expect(files.length).toBe(0);
    });

    it("should handle missing subagents directory gracefully during install", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "senior-swe",
      };

      // Remove the subagents directory from the installed profile
      const profileSubagentsDir = path.join(
        noriProfilesDir,
        "senior-swe",
        "subagents",
      );
      await fs.rm(profileSubagentsDir, { recursive: true, force: true });

      // Install should not throw
      await expect(installWithSkillset({ config })).resolves.not.toThrow();

      // Agents directory should still be created
      const exists = await fs
        .access(agentsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
