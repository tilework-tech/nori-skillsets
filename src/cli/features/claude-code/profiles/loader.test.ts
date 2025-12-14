/**
 * Tests for profiles feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir = "";

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

// Import loader after mocking env
import { profilesLoader, _testing } from "./loader.js";

describe("profilesLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "profiles-test-"));
    claudeDir = path.join(tempDir, ".claude");
    profilesDir = path.join(claudeDir, "profiles");

    // Set mock paths
    mockClaudeDir = claudeDir;

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
    it("should create profiles directory and copy profile templates for free installation", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify profiles directory exists
      const exists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify profile directories were copied (but not _base)
      const files = await fs.readdir(profilesDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain("senior-swe");
      expect(files).toContain("amol");
      expect(files).toContain("product-manager");
      expect(files).toContain("none");
      expect(files).not.toContain("_base"); // _base is never installed
    });

    it("should install none profile with only base mixin and empty CLAUDE.md", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify none profile exists
      const nonePath = path.join(profilesDir, "none");
      const noneExists = await fs
        .access(nonePath)
        .then(() => true)
        .catch(() => false);
      expect(noneExists).toBe(true);

      // Verify profile.json exists and has only base mixin
      const profileJsonPath = path.join(nonePath, "profile.json");
      const profileJson = JSON.parse(
        await fs.readFile(profileJsonPath, "utf-8"),
      );
      expect(profileJson.name).toBe("none");
      expect(profileJson.mixins).toEqual({ base: {} });

      // Verify CLAUDE.md exists and is empty or minimal
      const claudeMdPath = path.join(nonePath, "CLAUDE.md");
      const claudeMdContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(claudeMdContent.trim()).toBe("");

      // Verify only base mixin content is present
      const skillsDir = path.join(nonePath, "skills");
      const skills = await fs.readdir(skillsDir);

      // Should only have using-skills from base mixin
      expect(skills).toContain("using-skills");
      expect(skills).not.toContain("test-driven-development"); // from swe mixin
      expect(skills).not.toContain("updating-noridocs"); // from docs mixin
    });

    it("should create profiles directory and copy profile templates for paid installation", async () => {
      const config: Config = {
        installDir: tempDir,
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify profiles directory exists
      const exists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify profile directories were copied (but not _base)
      const files = await fs.readdir(profilesDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain("senior-swe");
      expect(files).toContain("amol");
      expect(files).toContain("product-manager");
      expect(files).toContain("none");
      expect(files).not.toContain("_base"); // _base is never installed
    });

    it("should copy profile directories with complete structure", async () => {
      const config: Config = {
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };

      await profilesLoader.run({ config });

      // Verify _base is NOT installed (it's only for composition)
      const basePath = path.join(profilesDir, "_base");
      const baseExists = await fs
        .access(basePath)
        .then(() => true)
        .catch(() => false);
      expect(baseExists).toBe(false);

      // Verify senior-swe profile exists and is fully composed
      const seniorSwePath = path.join(profilesDir, "senior-swe");
      const seniorSweExists = await fs
        .access(seniorSwePath)
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(true);

      // Verify it has CLAUDE.md and profile.json
      const claudeMdPath = path.join(seniorSwePath, "CLAUDE.md");
      const claudeMdExists = await fs
        .access(claudeMdPath)
        .then(() => true)
        .catch(() => false);
      expect(claudeMdExists).toBe(true);

      const profileJsonPath = path.join(seniorSwePath, "profile.json");
      const profileJsonExists = await fs
        .access(profileJsonPath)
        .then(() => true)
        .catch(() => false);
      expect(profileJsonExists).toBe(true);

      // Verify it has composed content from _base (skills, subagents, slashcommands)
      const skillsDir = path.join(seniorSwePath, "skills");
      const subagentsDir = path.join(seniorSwePath, "subagents");
      const slashcommandsDir = path.join(seniorSwePath, "slashcommands");

      expect(
        await fs
          .access(skillsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
      expect(
        await fs
          .access(subagentsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
      expect(
        await fs
          .access(slashcommandsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);
    });

    it("should handle reinstallation (update scenario)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First installation
      await profilesLoader.run({ config });

      // Verify initial installation
      let files = await fs.readdir(profilesDir);
      expect(files.length).toBeGreaterThan(0);

      // Second installation (update)
      await profilesLoader.run({ config });

      // Verify directories still exist after update
      files = await fs.readdir(profilesDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain("senior-swe");
      expect(files).toContain("amol");
      expect(files).toContain("product-manager");
    });
  });

  describe("uninstall", () => {
    it("should remove built-in profiles for free installation", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First install profiles
      await profilesLoader.run({ config });
      const exists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify built-in profiles exist
      const seniorSweExists = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(true);

      // Uninstall profiles
      await profilesLoader.uninstall({ config });

      // Verify built-in profiles were removed
      const seniorSweExistsAfter = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExistsAfter).toBe(false);

      const amolExistsAfter = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExistsAfter).toBe(false);
    });

    it("should remove built-in profiles for paid installation", async () => {
      const config: Config = {
        installDir: tempDir,
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First install profiles
      await profilesLoader.run({ config });
      const exists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify built-in profiles exist
      const seniorSweExists = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(true);

      // Uninstall profiles
      await profilesLoader.uninstall({ config });

      // Verify built-in profiles were removed
      const seniorSweExistsAfter = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExistsAfter).toBe(false);

      const amolExistsAfter = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExistsAfter).toBe(false);
    });

    it("should not throw if profiles directory does not exist", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Uninstall without installing first
      await expect(profilesLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should preserve custom user profiles during uninstall", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install built-in profiles
      await profilesLoader.run({ config });

      // Create a custom profile (no "builtin": true field)
      const customProfileDir = path.join(profilesDir, "my-custom-profile");
      await fs.mkdir(customProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(customProfileDir, "profile.json"),
        JSON.stringify({
          name: "my-custom-profile",
          description: "My custom profile",
          mixins: { base: {} },
        }),
      );
      await fs.writeFile(
        path.join(customProfileDir, "CLAUDE.md"),
        "# My Custom Profile\n",
      );

      // Verify built-in and custom profiles exist before uninstall
      const filesBeforeUninstall = await fs.readdir(profilesDir);
      expect(filesBeforeUninstall).toContain("senior-swe");
      expect(filesBeforeUninstall).toContain("amol");
      expect(filesBeforeUninstall).toContain("my-custom-profile");

      // Uninstall profiles
      await profilesLoader.uninstall({ config });

      // Verify custom profile still exists
      const customExists = await fs
        .access(customProfileDir)
        .then(() => true)
        .catch(() => false);
      expect(customExists).toBe(true);

      // Verify built-in profiles are removed
      const seniorSweExists = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(false);

      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(false);

      // Verify profiles directory itself still exists (not deleted)
      const profilesDirExists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(profilesDirExists).toBe(true);
    });
  });

  describe("validate", () => {
    it("should pass validation when all required profiles are installed", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install profiles
      await profilesLoader.run({ config });

      // Validate
      const result = await profilesLoader.validate!({ config });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
    });

    it("should fail validation when profiles directory does not exist", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Validate without installing
      const result = await profilesLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("should fail validation when required profiles are missing", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create profiles directory but don't copy profiles
      await fs.mkdir(profilesDir, { recursive: true });

      // Validate
      const result = await profilesLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("should fail validation when only some required profiles are present", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Create profiles directory and only one profile (senior-swe)
      await fs.mkdir(profilesDir, { recursive: true });
      const seniorSwePath = path.join(profilesDir, "senior-swe");
      await fs.mkdir(seniorSwePath, { recursive: true });
      await fs.writeFile(
        path.join(seniorSwePath, "CLAUDE.md"),
        "# Senior SWE Profile\n\nTest content",
      );

      // Validate (should fail because amol and product-manager are missing)
      const result = await profilesLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(
        result.errors!.some(
          (err) => err.includes("amol") || err.includes("product-manager"),
        ),
      ).toBe(true);
    });
  });

  describe("profile.json parsing", () => {
    it("should parse valid profile.json with extends field", async () => {
      const tempTestDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "profile-json-test-"),
      );

      const profileJson = {
        extends: "_base",
        name: "test-profile",
        description: "Test profile description",
      };

      const profilePath = path.join(tempTestDir, "test-profile");
      await fs.mkdir(profilePath, { recursive: true });
      await fs.writeFile(
        path.join(profilePath, "profile.json"),
        JSON.stringify(profileJson, null, 2),
      );

      const { readProfileMetadata } = await import("./metadata.js");
      const result = await readProfileMetadata({ profileDir: profilePath });

      expect(result).toEqual(profileJson);

      await fs.rm(tempTestDir, { recursive: true, force: true });
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

      // Install profiles
      await profilesLoader.run({ config });

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
      expect(settings.permissions.additionalDirectories).toContain(profilesDir);
    });

    it("should preserve existing settings when adding permissions", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Create settings.json with existing fields
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

      // Install profiles
      await profilesLoader.run({ config });

      // Verify existing fields are preserved
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.model).toBe("sonnet");
      expect(settings.existingField).toBe("should-be-preserved");
      expect(settings.permissions.additionalDirectories).toContain(profilesDir);
    });

    it("should not duplicate profiles directory in additionalDirectories", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Install profiles twice
      await profilesLoader.run({ config });
      await profilesLoader.run({ config });

      // Verify no duplicates
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      const count = settings.permissions.additionalDirectories.filter(
        (dir: string) => dir === profilesDir,
      ).length;

      expect(count).toBe(1);
    });

    it("should preserve existing additionalDirectories when adding profiles directory", async () => {
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

      // Install profiles
      await profilesLoader.run({ config });

      // Verify existing directories are preserved
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path1",
      );
      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path2",
      );
      expect(settings.permissions.additionalDirectories).toContain(profilesDir);
      // Now includes profiles + skills directories (profilesLoader calls skillsLoader)
      expect(settings.permissions.additionalDirectories.length).toBe(4);
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
      await profilesLoader.run({ config });

      // Verify permissions are configured
      let content = await fs.readFile(settingsPath, "utf-8");
      let settings = JSON.parse(content);
      expect(settings.permissions.additionalDirectories).toContain(profilesDir);

      // Uninstall
      await profilesLoader.uninstall({ config });

      // Verify permissions are removed
      content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);

      expect(
        settings.permissions?.additionalDirectories?.includes(profilesDir),
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

      // Install and then uninstall
      await profilesLoader.run({ config });
      await profilesLoader.uninstall({ config });

      // Verify existing directories are preserved
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path1",
      );
      expect(settings.permissions.additionalDirectories).toContain(
        "/existing/path2",
      );
      expect(
        settings.permissions.additionalDirectories.includes(profilesDir),
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

      await expect(profilesLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should validate permissions configuration", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // Install
      await profilesLoader.run({ config });

      // Validate
      const result = await profilesLoader.validate!({ config });

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

      // Install profiles but manually remove permissions
      await profilesLoader.run({ config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      delete settings.permissions;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      const result = await profilesLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
      expect(result.errors?.some((e) => e.includes("permissions"))).toBe(true);
    });
  });

  describe("injectConditionalMixins", () => {
    it("should inject paid mixin for paid user", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
          docs: {},
        },
      };

      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: {
          baseProfile: "test-profile",
        },
        installDir: tempDir,
      };

      const result = _testing.injectConditionalMixins({ metadata, config });

      expect(result.mixins).toHaveProperty("paid");
      expect(result.mixins).toHaveProperty("docs-paid");
    });

    it("should inject docs-paid mixin for paid user with docs category", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
          docs: {},
        },
      };

      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: {
          baseProfile: "test-profile",
        },
        installDir: tempDir,
      };

      const result = _testing.injectConditionalMixins({ metadata, config });

      expect(result.mixins).toHaveProperty("paid");
      expect(result.mixins).toHaveProperty("docs-paid");
      expect(Object.keys(result.mixins).sort()).toEqual([
        "base",
        "docs",
        "docs-paid",
        "paid",
      ]);
    });

    it("should inject swe-paid mixin for paid user with swe category", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
          swe: {},
        },
      };

      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: {
          baseProfile: "test-profile",
        },
        installDir: tempDir,
      };

      const result = _testing.injectConditionalMixins({ metadata, config });

      expect(result.mixins).toHaveProperty("paid");
      expect(result.mixins).toHaveProperty("swe-paid");
      expect(Object.keys(result.mixins).sort()).toEqual([
        "base",
        "paid",
        "swe",
        "swe-paid",
      ]);
    });

    it("should inject multiple tier-specific mixins for paid user with multiple categories", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
          docs: {},
          swe: {},
        },
      };

      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: {
          baseProfile: "test-profile",
        },
        installDir: tempDir,
      };

      const result = _testing.injectConditionalMixins({ metadata, config });

      expect(result.mixins).toHaveProperty("paid");
      expect(result.mixins).toHaveProperty("docs-paid");
      expect(result.mixins).toHaveProperty("swe-paid");
      expect(Object.keys(result.mixins).sort()).toEqual([
        "base",
        "docs",
        "docs-paid",
        "paid",
        "swe",
        "swe-paid",
      ]);
    });

    it("should not inject tier-specific mixins for free user", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
          docs: {},
          swe: {},
        },
      };

      const config: Config = {
        auth: null,
        profile: {
          baseProfile: "test-profile",
        },
        installDir: tempDir,
      };

      const result = _testing.injectConditionalMixins({ metadata, config });

      expect(result.mixins).not.toHaveProperty("paid");
      expect(result.mixins).not.toHaveProperty("docs-paid");
      expect(result.mixins).not.toHaveProperty("swe-paid");
      expect(Object.keys(result.mixins).sort()).toEqual([
        "base",
        "docs",
        "swe",
      ]);
    });

    it("should not duplicate tier-specific mixin if already present", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
          docs: {},
          "docs-paid": {}, // Already present
        },
      };

      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: {
          baseProfile: "test-profile",
        },
        installDir: tempDir,
      };

      const result = _testing.injectConditionalMixins({ metadata, config });

      expect(result.mixins).toHaveProperty("paid");
      expect(result.mixins).toHaveProperty("docs-paid");
      // Should only have one docs-paid entry
      expect(
        Object.keys(result.mixins).filter((k) => k === "docs-paid"),
      ).toHaveLength(1);
    });

    it("should not inject tier mixins for base or paid categories", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
          paid: {},
        },
      };

      const config: Config = {
        auth: {
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://example.com",
        },
        profile: {
          baseProfile: "test-profile",
        },
        installDir: tempDir,
      };

      const result = _testing.injectConditionalMixins({ metadata, config });

      // Should not create base-paid or paid-paid
      expect(result.mixins).not.toHaveProperty("base-paid");
      expect(result.mixins).not.toHaveProperty("paid-paid");
      expect(Object.keys(result.mixins).sort()).toEqual(["base", "paid"]);
    });
  });
});
