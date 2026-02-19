/**
 * Tests for skills feature loader
 * Verifies install operations using SkillsetPackage
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";
import type { SkillsetPackage } from "@/norijson/packageStructure.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSkillsDir: string;
let mockNoriDir: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => mockClaudeSkillsDir,
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  getNoriDir: () => mockNoriDir,
  getNoriProfilesDir: () => path.join(mockNoriDir, "profiles"),
}));

// Import loaders after mocking env
import { skillsLoader } from "./loader.js";

/**
 * Create a skill fixture directory on disk with a SKILL.md file
 *
 * @param args - Function arguments
 * @param args.parentDir - Directory to create the skill directory in
 * @param args.skillId - Skill directory name
 * @param args.content - Content for SKILL.md
 *
 * @returns Absolute path to the created skill directory
 */
const createSkillFixture = async (args: {
  parentDir: string;
  skillId: string;
  content: string;
}): Promise<string> => {
  const { parentDir, skillId, content } = args;
  const skillDir = path.join(parentDir, skillId);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), content);
  return skillDir;
};

// Standard test skills used across tests
const TEST_SKILL_CONTENT: Record<string, string> = {
  "using-skills": [
    "---",
    "name: Getting Started with Abilities",
    "description: Describes how to use abilities. Read before any conversation.",
    "---",
    "# Using Skills",
    "",
    "Skills at {{skills_dir}}/some-skill/SKILL.md",
  ].join("\n"),
  "updating-noridocs": [
    "---",
    "name: Updating Noridocs",
    "description: Use this when you have finished making code changes.",
    "---",
    "# Updating Noridocs",
  ].join("\n"),
  "creating-skills": [
    "---",
    "name: Creating-Skills",
    "description: Use when you need to create a new custom skill.",
    "---",
    "# Creating Skills",
  ].join("\n"),
};

/**
 * Build a SkillsetPackage from test fixture directories
 *
 * @param args - Function arguments
 * @param args.fixtureDir - Directory containing skill fixtures
 * @param args.skills - Map of skill ID to SKILL.md content
 *
 * @returns A SkillsetPackage with skills entries pointing to fixture dirs
 */
const buildTestPackage = async (args: {
  fixtureDir: string;
  skills: Record<string, string>;
}): Promise<SkillsetPackage> => {
  const { fixtureDir, skills } = args;
  const skillEntries = [];

  for (const [skillId, content] of Object.entries(skills)) {
    const sourceDir = await createSkillFixture({
      parentDir: fixtureDir,
      skillId,
      content,
    });
    skillEntries.push({ id: skillId, sourceDir });
  }

  return {
    claudeMd: null,
    skills: skillEntries,
    subagents: [],
    slashcommands: [],
  };
};

describe("skillsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let skillsDir: string;
  let fixtureDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
    claudeDir = path.join(tempDir, ".claude");
    skillsDir = path.join(claudeDir, "skills");
    fixtureDir = path.join(tempDir, "fixtures");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeSkillsDir = skillsDir;
    mockNoriDir = path.join(tempDir, ".nori");

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(fixtureDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create skills directory", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      await skillsLoader.install({ config, pkg });

      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it("should remove existing skills directory before installing", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      // Create skills directory with existing files
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(path.join(skillsDir, "old-skill.json"), "old content");

      await skillsLoader.install({ config, pkg });

      // Verify old file is gone
      const oldFileExists = await fs
        .access(path.join(skillsDir, "old-skill.json"))
        .then(() => true)
        .catch(() => false);

      expect(oldFileExists).toBe(false);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      // First installation
      await skillsLoader.install({ config, pkg });

      const firstCheck = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(firstCheck).toBe(true);

      // Second installation (update)
      await skillsLoader.install({ config, pkg });

      const secondCheck = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(secondCheck).toBe(true);
    });

    it("should install each skill from pkg.skills", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      await skillsLoader.install({ config, pkg });

      // All three skills should be installed
      for (const skillId of Object.keys(TEST_SKILL_CONTENT)) {
        const skillPath = path.join(skillsDir, skillId, "SKILL.md");
        const exists = await fs
          .access(skillPath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      }
    });

    it("should handle empty skills array", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg: SkillsetPackage = {
        claudeMd: null,
        skills: [],
        subagents: [],
        slashcommands: [],
      };

      await skillsLoader.install({ config, pkg });

      // Skills directory should exist but be empty
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const entries = await fs.readdir(skillsDir);
      expect(entries.length).toBe(0);
    });
  });

  describe("updating-noridocs skill", () => {
    it("should include updating-noridocs skill", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      await skillsLoader.install({ config, pkg });

      const skillPath = path.join(skillsDir, "updating-noridocs", "SKILL.md");

      const exists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      const content = await fs.readFile(skillPath, "utf-8");
      expect(content).toContain("---");
      expect(content).toContain("name: Updating Noridocs");
      expect(content).toContain("description:");
    });
  });

  describe("template substitution", () => {
    it("should apply template substitution to skill markdown files", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      await skillsLoader.install({ config, pkg });

      const skillPath = path.join(skillsDir, "using-skills", "SKILL.md");
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).not.toContain("{{skills_dir}}");
      expect(content).not.toContain("{{install_dir}}");
    });

    it("should resolve {{skills_dir}} to .claude/skills, not installDir/skills", async () => {
      const config: Config = { installDir: tempDir, agents: {} };

      // Create a skill with multiple template variables
      const templateContent = [
        "---",
        "name: Template Test",
        "description: Test template resolution",
        "---",
        "Skills at {{skills_dir}}/foo/SKILL.md",
        "Commands at {{commands_dir}}/bar.md",
        "Config at {{install_dir}}/.nori-config.json",
        "Profiles at {{profiles_dir}}/senior-swe",
      ].join("\n");

      const pkg = await buildTestPackage({
        fixtureDir,
        skills: { "template-test": templateContent },
      });

      await skillsLoader.install({ config, pkg });

      const content = await fs.readFile(
        path.join(skillsDir, "template-test", "SKILL.md"),
        "utf-8",
      );

      // {{skills_dir}} must resolve to <tempDir>/.claude/skills
      expect(content).toContain(
        path.join(tempDir, ".claude", "skills", "foo", "SKILL.md"),
      );
      expect(content).not.toContain(
        path.join(tempDir, "skills", "foo", "SKILL.md"),
      );

      // {{commands_dir}} must resolve to <tempDir>/.claude/commands
      expect(content).toContain(
        path.join(tempDir, ".claude", "commands", "bar.md"),
      );

      // {{install_dir}} must resolve to <tempDir>
      expect(content).toContain(path.join(tempDir, ".nori-config.json"));

      // {{profiles_dir}} must resolve to <tempDir>/.nori/profiles
      expect(content).toContain(
        path.join(tempDir, ".nori", "profiles", "senior-swe"),
      );
    });

    it("should apply template substitution for custom install directory", async () => {
      const customInstallDir = path.join(tempDir, "custom-install", ".claude");
      await fs.mkdir(customInstallDir, { recursive: true });

      mockClaudeDir = customInstallDir;
      mockClaudeSkillsDir = path.join(customInstallDir, "skills");

      const customInstallBase = path.join(tempDir, "custom-install");
      const config: Config = { installDir: customInstallBase, agents: {} };

      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      await skillsLoader.install({ config, pkg });

      const skillPath = path.join(
        customInstallDir,
        "skills",
        "using-skills",
        "SKILL.md",
      );
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).not.toContain("{{skills_dir}}");
      expect(content).not.toContain("{{install_dir}}");

      if (content.includes("skills/")) {
        expect(content).not.toContain("~/.claude/skills/");
      }
    });
  });

  describe("creating-skills skill", () => {
    it("should install creating-skills skill", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });

      await skillsLoader.install({ config, pkg });

      const skillPath = path.join(skillsDir, "creating-skills", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);

      const content = await fs.readFile(skillPath, "utf-8");
      expect(content).toContain("name: Creating-Skills");
      expect(content).toContain("description:");
    });
  });

  describe("permissions configuration", () => {
    it("should configure permissions.additionalDirectories in settings.json", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });
      const settingsPath = path.join(claudeDir, "settings.json");

      await skillsLoader.install({ config, pkg });

      const exists = await fs
        .access(settingsPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.permissions).toBeDefined();
      expect(settings.permissions.additionalDirectories).toBeDefined();
      expect(settings.permissions.additionalDirectories).toContain(skillsDir);
    });

    it("should preserve existing settings when adding permissions", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.writeFile(
        settingsPath,
        JSON.stringify(
          {
            $schema: "https://json.schemastore.org/claude-code-settings.json",
            model: "sonnet",
            existingField: "should-be-preserved",
          },
          null,
          2,
        ),
      );

      await skillsLoader.install({ config, pkg });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.model).toBe("sonnet");
      expect(settings.existingField).toBe("should-be-preserved");
      expect(settings.permissions.additionalDirectories).toContain(skillsDir);
    });

    it("should not duplicate skills directory in additionalDirectories", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });
      const settingsPath = path.join(claudeDir, "settings.json");

      await skillsLoader.install({ config, pkg });
      await skillsLoader.install({ config, pkg });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      const count = settings.permissions.additionalDirectories.filter(
        (dir: string) => dir === skillsDir,
      ).length;

      expect(count).toBe(1);
    });

    it("should preserve existing additionalDirectories when adding skills directory", async () => {
      const config: Config = { installDir: tempDir, agents: {} };
      const pkg = await buildTestPackage({
        fixtureDir,
        skills: TEST_SKILL_CONTENT,
      });
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.writeFile(
        settingsPath,
        JSON.stringify(
          {
            $schema: "https://json.schemastore.org/claude-code-settings.json",
            permissions: {
              additionalDirectories: ["/existing/path1", "/existing/path2"],
            },
          },
          null,
          2,
        ),
      );

      await skillsLoader.install({ config, pkg });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path1",
      );
      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path2",
      );
      expect(settings.permissions.additionalDirectories).toContain(skillsDir);
      expect(settings.permissions.additionalDirectories.length).toBe(3);
    });
  });
});
