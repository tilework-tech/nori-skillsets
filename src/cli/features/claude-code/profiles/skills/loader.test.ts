/**
 * Tests for skills feature loader
 * Verifies install operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

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
  getNoriConfigFile: () => path.join(mockNoriDir, "config.json"),
}));

// Import loaders after mocking env
import { skillsLoader } from "./loader.js";

/**
 * Create a stub profile directory with nori.json and optional skills/skills.json
 *
 * @param args - Function arguments
 * @param args.profilesDir - Path to the profiles directory
 * @param args.profileName - Name of the profile
 * @param args.skills - Optional map of skill name to SKILL.md content
 */
const createStubProfile = async (args: {
  profilesDir: string;
  profileName: string;
  skills?: Record<string, string> | null;
}): Promise<void> => {
  const { profilesDir, profileName, skills } = args;
  const profileDir = path.join(profilesDir, profileName);
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(profileDir, "nori.json"),
    JSON.stringify({ name: "Test Profile", version: "1.0.0" }),
  );

  if (skills != null && Object.keys(skills).length > 0) {
    for (const [skillName, skillContent] of Object.entries(skills)) {
      const skillDir = path.join(profileDir, "skills", skillName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), skillContent);
    }
  }
};

// Standard test skills used across tests
const TEST_SKILLS: Record<string, string> = {
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

describe("skillsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let skillsDir: string;
  let noriProfilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
    claudeDir = path.join(tempDir, ".claude");
    skillsDir = path.join(claudeDir, "skills");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeSkillsDir = skillsDir;
    mockNoriDir = path.join(tempDir, ".nori");
    noriProfilesDir = path.join(mockNoriDir, "profiles");

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriProfilesDir, { recursive: true });

    // Create stub profile with test skills
    await createStubProfile({
      profilesDir: noriProfilesDir,
      profileName: "senior-swe",
      skills: TEST_SKILLS,
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should create skills directory", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await skillsLoader.install({ config });

      // Verify skills directory exists
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it("should remove existing skills directory before installing", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create skills directory with existing files
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(path.join(skillsDir, "old-skill.json"), "old content");

      await skillsLoader.install({ config });

      // Verify old file is gone
      const oldFileExists = await fs
        .access(path.join(skillsDir, "old-skill.json"))
        .then(() => true)
        .catch(() => false);

      expect(oldFileExists).toBe(false);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First installation
      await skillsLoader.install({ config });

      const firstCheck = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(firstCheck).toBe(true);

      // Second installation (update)
      await skillsLoader.install({ config });

      const secondCheck = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(secondCheck).toBe(true);
    });
  });

  // Validate tests removed - no longer relevant as skills are now installed via profilesLoader
  // Validation is tested at the profilesLoader level

  describe("updating-noridocs skill", () => {
    it("should include updating-noridocs skill", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await skillsLoader.install({ config });

      // Check if the updating-noridocs skill exists
      const skillPath = path.join(skillsDir, "updating-noridocs", "SKILL.md");

      const exists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify the skill file has proper YAML frontmatter
      const content = await fs.readFile(skillPath, "utf-8");
      expect(content).toContain("---");
      expect(content).toContain("name: Updating Noridocs");
      expect(content).toContain("description:");
    });
  });

  describe("template substitution", () => {
    it("should apply template substitution to skill markdown files for home install", async () => {
      // tempDir simulates a home install at /tmp/xxx/.claude
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await skillsLoader.install({ config });

      // Check a skill that references {{skills_dir}}
      const skillPath = path.join(skillsDir, "using-skills", "SKILL.md");
      const content = await fs.readFile(skillPath, "utf-8");

      // Should have template placeholders substituted
      // For a home install, paths should use tilde notation
      expect(content).not.toContain("{{skills_dir}}");
      expect(content).not.toContain("{{install_dir}}");
    });

    it("should resolve {{skills_dir}} to .claude/skills, not installDir/skills", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create a test skill with known template variables in the profile's skills dir
      const profileSkillDir = path.join(
        mockNoriDir,
        "profiles",
        "senior-swe",
        "skills",
        "template-test",
      );
      await fs.mkdir(profileSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(profileSkillDir, "SKILL.md"),
        [
          "---",
          "name: Template Test",
          "description: Test template resolution",
          "---",
          "Skills at {{skills_dir}}/foo/SKILL.md",
          "Commands at {{commands_dir}}/bar.md",
          "Config at {{install_dir}}/.nori-config.json",
          "Profiles at {{profiles_dir}}/senior-swe",
        ].join("\n"),
      );

      await skillsLoader.install({ config });

      const content = await fs.readFile(
        path.join(skillsDir, "template-test", "SKILL.md"),
        "utf-8",
      );

      // {{skills_dir}} must resolve to <tempDir>/.claude/skills (not <tempDir>/skills)
      expect(content).toContain(
        path.join(tempDir, ".claude", "skills", "foo", "SKILL.md"),
      );
      expect(content).not.toContain(
        path.join(tempDir, "skills", "foo", "SKILL.md"),
      );

      // {{commands_dir}} must resolve to <tempDir>/.claude/commands (not <tempDir>/commands)
      expect(content).toContain(
        path.join(tempDir, ".claude", "commands", "bar.md"),
      );

      // {{install_dir}} must resolve to <tempDir> (not dirname(tempDir))
      expect(content).toContain(path.join(tempDir, ".nori-config.json"));

      // {{profiles_dir}} must resolve to <tempDir>/.nori/profiles (not dirname(tempDir)/.nori/profiles)
      expect(content).toContain(
        path.join(tempDir, ".nori", "profiles", "senior-swe"),
      );
    });

    it("should apply template substitution to skill markdown files for custom install", async () => {
      // Create a custom install directory (not under home)
      const customInstallDir = path.join(tempDir, "custom-install", ".claude");
      await fs.mkdir(customInstallDir, { recursive: true });

      // Update mock paths
      mockClaudeDir = customInstallDir;
      mockClaudeSkillsDir = path.join(customInstallDir, "skills");

      const customInstallBase = path.join(tempDir, "custom-install");
      const customNoriProfilesDir = path.join(
        customInstallBase,
        ".nori",
        "profiles",
      );

      const config: Config = {
        installDir: customInstallBase,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create stub profile in the custom install location
      await createStubProfile({
        profilesDir: customNoriProfilesDir,
        profileName: "senior-swe",
        skills: TEST_SKILLS,
      });
      await skillsLoader.install({ config });

      // Check a skill that references {{skills_dir}}
      const skillPath = path.join(
        customInstallDir,
        "skills",
        "using-skills",
        "SKILL.md",
      );
      const content = await fs.readFile(skillPath, "utf-8");

      // Should have template placeholders substituted with absolute paths
      expect(content).not.toContain("{{skills_dir}}");
      expect(content).not.toContain("{{install_dir}}");

      // For custom install, paths should be absolute (not tilde)
      // If the skill references the skills directory, it should use absolute path
      if (content.includes("skills/")) {
        expect(content).not.toContain("~/.claude/skills/");
      }
    });
  });

  describe("creating-skills skill", () => {
    it("should install creating-skills skill", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await skillsLoader.install({ config });

      const skillPath = path.join(skillsDir, "creating-skills", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);

      // Verify frontmatter
      const content = await fs.readFile(skillPath, "utf-8");
      expect(content).toContain("name: Creating-Skills");
      expect(content).toContain("description:");
    });
  });

  describe("permissions configuration", () => {
    it("should configure permissions.additionalDirectories in settings.json", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await skillsLoader.install({ config });

      // Verify settings.json exists
      const exists = await fs
        .access(settingsPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify permissions are configured
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.permissions).toBeDefined();
      expect(settings.permissions.additionalDirectories).toBeDefined();
      expect(settings.permissions.additionalDirectories).toContain(skillsDir);
    });

    it("should preserve existing settings when adding permissions", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Create settings.json with existing configuration
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

      await skillsLoader.install({ config });

      // Verify existing settings are preserved
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.model).toBe("sonnet");
      expect(settings.existingField).toBe("should-be-preserved");
      expect(settings.permissions.additionalDirectories).toContain(skillsDir);
    });

    it("should not duplicate skills directory in additionalDirectories", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // First installation
      await skillsLoader.install({ config });

      // Second installation (update scenario)
      await skillsLoader.install({ config });

      // Verify skills directory appears only once
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      const count = settings.permissions.additionalDirectories.filter(
        (dir: string) => dir === skillsDir,
      ).length;

      expect(count).toBe(1);
    });

    it("should preserve existing additionalDirectories when adding skills directory", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Create settings.json with existing additionalDirectories
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

      await skillsLoader.install({ config });

      // Verify existing paths are preserved
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

    it("should handle missing profile skills directory gracefully during install", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Remove the skills directory from the installed profile
      const profileSkillsDir = path.join(
        claudeDir,
        "profiles",
        "senior-swe",
        "skills",
      );
      await fs.rm(profileSkillsDir, { recursive: true, force: true });

      // Install should not throw
      await expect(skillsLoader.install({ config })).resolves.not.toThrow();

      // Skills directory should still be created (empty)
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe("skills.json support (external skills)", () => {
    // Note: External skills are stored in the PROFILE's skills directory ({profileDir}/skills/)
    // NOT in a global ~/.nori/skills/ directory. The skills.json references dependencies
    // that were downloaded by registry-download to the profile's skills directory.

    it("should install skills from both inline folder and skills.json", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create a skills.json in the profile directory
      const profileDir = path.join(mockNoriDir, "profiles", "senior-swe");
      await fs.writeFile(
        path.join(profileDir, "skills.json"),
        JSON.stringify({
          "external-skill": "^1.0.0",
        }),
      );

      // Create the external skill in the PROFILE's skills directory
      // (this is where registry-download puts skill dependencies)
      const externalSkillDir = path.join(
        profileDir,
        "skills",
        "external-skill",
      );
      await fs.mkdir(externalSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(externalSkillDir, "SKILL.md"),
        "---\nname: External Skill\ndescription: An external skill\n---\n# External Skill\n",
      );

      await skillsLoader.install({ config });

      // Should have inline skills
      const inlineSkillExists = await fs
        .access(path.join(skillsDir, "using-skills", "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      expect(inlineSkillExists).toBe(true);

      // Should have external skill
      const externalSkillExists = await fs
        .access(path.join(skillsDir, "external-skill", "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      expect(externalSkillExists).toBe(true);
    });

    it("should prefer external skill over inline when same name exists", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create a skills.json that references a skill that also exists inline
      const profileDir = path.join(mockNoriDir, "profiles", "senior-swe");
      await fs.writeFile(
        path.join(profileDir, "skills.json"),
        JSON.stringify({
          "using-skills": "^2.0.0",
        }),
      );

      // Create the external version in the PROFILE's skills directory
      const externalSkillDir = path.join(profileDir, "skills", "using-skills");
      await fs.mkdir(externalSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(externalSkillDir, "SKILL.md"),
        "---\nname: Using Skills\ndescription: External version 2.0.0\n---\n# EXTERNAL VERSION\n",
      );

      await skillsLoader.install({ config });

      // Should have the external version (contains "EXTERNAL VERSION")
      const content = await fs.readFile(
        path.join(skillsDir, "using-skills", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("EXTERNAL VERSION");
    });

    it("should NOT read skills from global ~/.nori/skills/ directory", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create a skills.json referencing a skill
      const profileDir = path.join(mockNoriDir, "profiles", "senior-swe");
      await fs.writeFile(
        path.join(profileDir, "skills.json"),
        JSON.stringify({
          "global-only-skill": "^1.0.0",
        }),
      );

      // Create the skill ONLY in the global ~/.nori/skills/ directory (old path)
      // This should NOT be found since we now read from profile directory
      const globalSkillDir = path.join(
        mockNoriDir,
        "skills",
        "global-only-skill",
      );
      await fs.mkdir(globalSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(globalSkillDir, "SKILL.md"),
        "---\nname: Global Only Skill\ndescription: Should not be found\n---\n# Global Only\n",
      );

      await skillsLoader.install({ config });

      // The global-only skill should NOT be installed because we don't read from global path
      const globalSkillExists = await fs
        .access(path.join(skillsDir, "global-only-skill", "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      expect(globalSkillExists).toBe(false);
    });

    it("should work when profile has no skills.json", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Ensure no skills.json exists
      const profileDir = path.join(mockNoriDir, "profiles", "senior-swe");
      await fs.rm(path.join(profileDir, "skills.json"), { force: true });

      await skillsLoader.install({ config });

      // Should still have inline skills
      const inlineSkillExists = await fs
        .access(path.join(skillsDir, "using-skills", "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      expect(inlineSkillExists).toBe(true);
    });

    it("should apply template substitution to external skills", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create a skills.json
      const profileDir = path.join(mockNoriDir, "profiles", "senior-swe");
      await fs.writeFile(
        path.join(profileDir, "skills.json"),
        JSON.stringify({
          "templated-skill": "^1.0.0",
        }),
      );

      // Create the external skill with template placeholders in the PROFILE's skills directory
      const externalSkillDir = path.join(
        profileDir,
        "skills",
        "templated-skill",
      );
      await fs.mkdir(externalSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(externalSkillDir, "SKILL.md"),
        "---\nname: Templated Skill\ndescription: Test\n---\nSkills are at {{skills_dir}}\n",
      );

      await skillsLoader.install({ config });

      // Template should be substituted
      const content = await fs.readFile(
        path.join(skillsDir, "templated-skill", "SKILL.md"),
        "utf-8",
      );
      expect(content).not.toContain("{{skills_dir}}");
    });
  });
});
