/**
 * Tests for skills feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { profilesLoader } from "@/cli/features/claude-code/profiles/loader.js";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSkillsDir: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => mockClaudeSkillsDir,
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

// Import loaders after mocking env
import { skillsLoader } from "./loader.js";

describe("skillsLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
    claudeDir = path.join(tempDir, ".claude");
    skillsDir = path.join(claudeDir, "skills");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeSkillsDir = skillsDir;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });

    // Run profiles loader to populate ~/.claude/profiles/ directory with composed profiles
    // This is required since feature loaders now read from ~/.claude/profiles/
    const config: Config = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "senior-swe" } },
      },
    };
    await profilesLoader.run({ config });
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

  describe("uninstall", () => {
    it("should remove skills directory", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install first
      await skillsLoader.install({ config });

      // Verify it exists
      let exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Uninstall
      await skillsLoader.uninstall({ config });

      // Verify it's removed
      exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("should handle missing skills directory gracefully", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Uninstall without installing first
      await expect(skillsLoader.uninstall({ config })).resolves.not.toThrow();

      // Verify directory still doesn't exist
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(false);
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

    it("should apply template substitution to skill markdown files for custom install", async () => {
      // Create a custom install directory (not under home)
      const customInstallDir = path.join(tempDir, "custom-install", ".claude");
      await fs.mkdir(customInstallDir, { recursive: true });

      // Update mock paths
      mockClaudeDir = customInstallDir;
      mockClaudeSkillsDir = path.join(customInstallDir, "skills");

      const config: Config = {
        installDir: path.join(tempDir, "custom-install"),
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Run profiles loader for custom install
      await profilesLoader.run({ config });
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

  describe("paid skills", () => {
    it("should install paid-prefixed skills without prefix for paid tier", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.install({ config });

      // Should exist without prefix
      const memorizeExists = await fs
        .access(path.join(skillsDir, "memorize", "SKILL.md"))
        .then(() => true)
        .catch(() => false);

      expect(memorizeExists).toBe(true);

      // Should not exist with prefix
      const paidMemorizeExists = await fs
        .access(path.join(skillsDir, "paid-memorize", "SKILL.md"))
        .then(() => true)
        .catch(() => false);

      expect(paidMemorizeExists).toBe(false);
    });

    it("should not install paid-prefixed skills for free tier", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await skillsLoader.install({ config });

      // Should not exist with or without prefix
      const memorizeExists = await fs
        .access(path.join(skillsDir, "memorize", "SKILL.md"))
        .then(() => true)
        .catch(() => false);

      expect(memorizeExists).toBe(false);

      const paidMemorizeExists = await fs
        .access(path.join(skillsDir, "paid-memorize", "SKILL.md"))
        .then(() => true)
        .catch(() => false);

      expect(paidMemorizeExists).toBe(false);
    });

    it("should install paid-recall skill without prefix for paid tier", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.install({ config });

      const skillPath = path.join(skillsDir, "recall", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should install paid-read-noridoc skill without prefix for paid tier", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.install({ config });

      const skillPath = path.join(skillsDir, "read-noridoc", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should install paid-write-noridoc skill without prefix for paid tier", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.install({ config });

      const skillPath = path.join(skillsDir, "write-noridoc", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should install paid-list-noridocs skill without prefix for paid tier", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.install({ config });

      const skillPath = path.join(skillsDir, "list-noridocs", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should install nori-sync-docs skill for paid tier", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.install({ config });

      // Skill should be installed as nori-sync-docs (matching the slash command reference)
      const skillPath = path.join(skillsDir, "nori-sync-docs", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);

      // Verify the skill content references the correct script path
      const content = await fs.readFile(skillPath, "utf-8");
      expect(content).toContain("nori-sync-docs/script.js");
    });

    it("should not install any paid skills for free tier", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await skillsLoader.install({ config });

      const paidSkills = [
        "memorize",
        "recall",
        "read-noridoc",
        "write-noridoc",
        "list-noridocs",
      ];

      for (const skill of paidSkills) {
        const skillPath = path.join(skillsDir, skill);
        const exists = await fs
          .access(skillPath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(false);
      }
    });

    it("should install creating-skills skill from _base mixin for free tier", async () => {
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

    it("should install creating-skills skill from _base mixin for paid tier", async () => {
      const config: Config = {
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.install({ config });

      const skillPath = path.join(skillsDir, "creating-skills", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
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

    it("should remove permissions on uninstall", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Install first
      await skillsLoader.install({ config });

      // Verify permissions are configured
      let content = await fs.readFile(settingsPath, "utf-8");
      let settings = JSON.parse(content);
      expect(settings.permissions.additionalDirectories).toContain(skillsDir);

      // Uninstall
      await skillsLoader.uninstall({ config });

      // Verify permissions are removed
      content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);

      expect(
        settings.permissions?.additionalDirectories?.includes(skillsDir),
      ).toBeFalsy();
    });

    it("should preserve other additionalDirectories on uninstall", async () => {
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

      // Install (adds skills directory)
      await skillsLoader.install({ config });

      // Uninstall
      await skillsLoader.uninstall({ config });

      // Verify existing paths are preserved, skills directory is removed
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path1",
      );
      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path2",
      );
      expect(
        settings.permissions.additionalDirectories.includes(skillsDir),
      ).toBe(false);
      expect(settings.permissions.additionalDirectories.length).toBe(2);
    });

    it("should handle missing settings.json on uninstall gracefully", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Uninstall without settings.json
      await expect(skillsLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should validate permissions configuration", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install
      await skillsLoader.install({ config });

      // Validate
      if (skillsLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await skillsLoader.validate({ config });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
    });

    it("should return invalid when permissions are not configured", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Install skills but manually remove permissions
      await skillsLoader.install({ config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      delete settings.permissions;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      if (skillsLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await skillsLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(result.errors?.some((e) => e.includes("permissions"))).toBe(true);
    });
  });
});
