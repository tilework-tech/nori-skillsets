/**
 * Tests for skills feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { profilesLoader } from "@/installer/features/profiles/loader.js";

import type { Config } from "@/installer/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSkillsDir: string;

vi.mock("@/installer/env.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => mockClaudeSkillsDir,
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
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
    const config: Config = { installType: "free", installDir: tempDir };
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
      const config: Config = { installType: "free", installDir: tempDir };

      await skillsLoader.run({ config });

      // Verify skills directory exists
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it("should remove existing skills directory before installing", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Create skills directory with existing files
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(path.join(skillsDir, "old-skill.json"), "old content");

      await skillsLoader.run({ config });

      // Verify old file is gone
      const oldFileExists = await fs
        .access(path.join(skillsDir, "old-skill.json"))
        .then(() => true)
        .catch(() => false);

      expect(oldFileExists).toBe(false);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // First installation
      await skillsLoader.run({ config });

      const firstCheck = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(firstCheck).toBe(true);

      // Second installation (update)
      await skillsLoader.run({ config });

      const secondCheck = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(secondCheck).toBe(true);
    });
  });

  describe("uninstall", () => {
    it("should remove skills directory", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Install first
      await skillsLoader.run({ config });

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
      const config: Config = { installType: "free", installDir: tempDir };

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

  describe("validate", () => {
    it("should return valid for properly installed skills", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Install
      await skillsLoader.run({ config });

      // Validate
      if (skillsLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await skillsLoader.validate({ config });

      expect(result.valid).toBe(true);
      expect(result.message).toContain("properly installed");
      expect(result.errors).toBeNull();
    });

    it("should return invalid when skills directory does not exist", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Validate without installing
      if (skillsLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await skillsLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("not found");
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe("updating-noridocs skill", () => {
    it("should include updating-noridocs skill", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      await skillsLoader.run({ config });

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

  describe("paid skills", () => {
    it("should install paid-prefixed skills without prefix for paid tier", async () => {
      const config: Config = {
        installType: "paid",
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.run({ config });

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
      const config: Config = { installType: "free", installDir: tempDir };

      await skillsLoader.run({ config });

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
        installType: "paid",
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.run({ config });

      const skillPath = path.join(skillsDir, "recall", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should install paid-read-noridoc skill without prefix for paid tier", async () => {
      const config: Config = {
        installType: "paid",
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.run({ config });

      const skillPath = path.join(skillsDir, "read-noridoc", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should install paid-write-noridoc skill without prefix for paid tier", async () => {
      const config: Config = {
        installType: "paid",
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.run({ config });

      const skillPath = path.join(skillsDir, "write-noridoc", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should install paid-list-noridocs skill without prefix for paid tier", async () => {
      const config: Config = {
        installType: "paid",
        auth: {
          username: "test",
          password: "test",
          organizationUrl: "https://test.com",
        },
        installDir: tempDir,
      };

      // Recompose profiles with paid mixin
      await profilesLoader.run({ config });

      await skillsLoader.run({ config });

      const skillPath = path.join(skillsDir, "list-noridocs", "SKILL.md");

      const skillExists = await fs
        .access(skillPath)
        .then(() => true)
        .catch(() => false);

      expect(skillExists).toBe(true);
    });

    it("should not install any paid skills for free tier", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      await skillsLoader.run({ config });

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
  });

  describe("permissions configuration", () => {
    it("should configure permissions.additionalDirectories in settings.json", async () => {
      const config: Config = { installType: "free", installDir: tempDir };
      const settingsPath = path.join(claudeDir, "settings.json");

      await skillsLoader.run({ config });

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
      const config: Config = { installType: "free", installDir: tempDir };
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

      await skillsLoader.run({ config });

      // Verify existing settings are preserved
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.model).toBe("sonnet");
      expect(settings.existingField).toBe("should-be-preserved");
      expect(settings.permissions.additionalDirectories).toContain(skillsDir);
    });

    it("should not duplicate skills directory in additionalDirectories", async () => {
      const config: Config = { installType: "free", installDir: tempDir };
      const settingsPath = path.join(claudeDir, "settings.json");

      // First installation
      await skillsLoader.run({ config });

      // Second installation (update scenario)
      await skillsLoader.run({ config });

      // Verify skills directory appears only once
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      const count = settings.permissions.additionalDirectories.filter(
        (dir: string) => dir === skillsDir,
      ).length;

      expect(count).toBe(1);
    });

    it("should preserve existing additionalDirectories when adding skills directory", async () => {
      const config: Config = { installType: "free", installDir: tempDir };
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

      await skillsLoader.run({ config });

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
      const config: Config = { installType: "free", installDir: tempDir };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Install first
      await skillsLoader.run({ config });

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
      const config: Config = { installType: "free", installDir: tempDir };
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
      await skillsLoader.run({ config });

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
      const config: Config = { installType: "free", installDir: tempDir };

      // Uninstall without settings.json
      await expect(skillsLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should validate permissions configuration", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Install
      await skillsLoader.run({ config });

      // Validate
      if (skillsLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await skillsLoader.validate({ config });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
    });

    it("should return invalid when permissions are not configured", async () => {
      const config: Config = { installType: "free", installDir: tempDir };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Install skills but manually remove permissions
      await skillsLoader.run({ config });

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
