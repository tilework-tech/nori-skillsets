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
let mockNoriDir = "";

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  // New Nori paths
  getNoriDir: () => mockNoriDir,
  getNoriProfilesDir: () => path.join(mockNoriDir, "profiles"),
  getNoriConfigFile: () => path.join(mockNoriDir, "config.json"),
}));

// Import loader after mocking env
import { profilesLoader, _testing } from "./loader.js";

describe("profilesLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let noriDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "profiles-test-"));
    claudeDir = path.join(tempDir, ".claude");
    noriDir = path.join(tempDir, ".nori");
    profilesDir = path.join(noriDir, "profiles");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockNoriDir = noriDir;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriDir, { recursive: true });
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
      expect(files).toContain("onboarding-wizard-questionnaire");
      expect(files).not.toContain("_base"); // _base is never installed
    });

    it("should install onboarding-wizard-questionnaire profile with correct structure", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify onboarding-wizard-questionnaire profile exists
      const wizardPath = path.join(
        profilesDir,
        "onboarding-wizard-questionnaire",
      );
      const wizardExists = await fs
        .access(wizardPath)
        .then(() => true)
        .catch(() => false);
      expect(wizardExists).toBe(true);

      // Verify nori.json exists and has correct metadata (replaces profile.json)
      const noriJsonPath = path.join(wizardPath, "nori.json");
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));
      expect(noriJson.name).toBe("onboarding-wizard-questionnaire");
      expect(noriJson.version).toBe("1.0.0");
      expect(noriJson.description).toContain("questionnaire");

      // Verify profile.json does NOT exist (replaced by nori.json)
      const profileJsonPath = path.join(wizardPath, "profile.json");
      const profileJsonExists = await fs
        .access(profileJsonPath)
        .then(() => true)
        .catch(() => false);
      expect(profileJsonExists).toBe(false);

      // Verify CLAUDE.md exists and contains wizard instructions
      const claudeMdPath = path.join(wizardPath, "CLAUDE.md");
      const claudeMdContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(claudeMdContent).toContain("Onboarding Wizard (Questionnaire)");
    });

    it("should install none profile with only base content and empty CLAUDE.md", async () => {
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

      // Verify nori.json exists and has correct metadata (replaces profile.json)
      const noriJsonPath = path.join(nonePath, "nori.json");
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));
      expect(noriJson.name).toBe("none");
      expect(noriJson.version).toBe("1.0.0");

      // Verify CLAUDE.md exists and is empty or minimal
      const claudeMdPath = path.join(nonePath, "CLAUDE.md");
      const claudeMdContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(claudeMdContent.trim()).toBe("");

      // Verify only base content is present (inlined directly in profile)
      const skillsDir = path.join(nonePath, "skills");
      const skills = await fs.readdir(skillsDir);

      // Should only have base skills (using-skills, creating-skills)
      expect(skills).toContain("using-skills");
      expect(skills).toContain("creating-skills");
      expect(skills).not.toContain("test-driven-development"); // swe content
      expect(skills).not.toContain("updating-noridocs"); // docs content
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
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
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

      // Verify it has CLAUDE.md and nori.json (not profile.json)
      const claudeMdPath = path.join(seniorSwePath, "CLAUDE.md");
      const claudeMdExists = await fs
        .access(claudeMdPath)
        .then(() => true)
        .catch(() => false);
      expect(claudeMdExists).toBe(true);

      const noriJsonPath = path.join(seniorSwePath, "nori.json");
      const noriJsonExists = await fs
        .access(noriJsonPath)
        .then(() => true)
        .catch(() => false);
      expect(noriJsonExists).toBe(true);

      // Verify profile.json does NOT exist
      const profileJsonPath = path.join(seniorSwePath, "profile.json");
      const profileJsonExists = await fs
        .access(profileJsonPath)
        .then(() => true)
        .catch(() => false);
      expect(profileJsonExists).toBe(false);

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

    it("should install senior-swe profile with all skills inlined directly", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      const seniorSwePath = path.join(profilesDir, "senior-swe");

      // Verify nori.json has correct metadata (replaces profile.json)
      const noriJsonPath = path.join(seniorSwePath, "nori.json");
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));
      expect(noriJson.name).toBe("senior-swe");
      expect(noriJson.version).toBe("1.0.0");
      expect(noriJson.description).toBeDefined();

      // Verify skills are present directly (not composed from mixins)
      const skillsDir = path.join(seniorSwePath, "skills");
      const skills = await fs.readdir(skillsDir);

      // Base skills
      expect(skills).toContain("using-skills");
      expect(skills).toContain("creating-skills");

      // Docs skills
      expect(skills).toContain("updating-noridocs");

      // SWE skills
      expect(skills).toContain("test-driven-development");
      expect(skills).toContain("systematic-debugging");
      expect(skills).toContain("writing-plans");
      expect(skills).toContain("using-git-worktrees");

      // Verify subagents are present
      const subagentsDir = path.join(seniorSwePath, "subagents");
      const subagents = await fs.readdir(subagentsDir);
      expect(subagents).toContain("nori-web-search-researcher.md");
      expect(subagents).toContain("nori-codebase-locator.md");
    });

    it("should install onboarding-wizard-questionnaire with NO skills (wizard only)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      const wizardPath = path.join(
        profilesDir,
        "onboarding-wizard-questionnaire",
      );

      // Verify nori.json has correct metadata (replaces profile.json)
      const noriJsonPath = path.join(wizardPath, "nori.json");
      const noriJson = JSON.parse(await fs.readFile(noriJsonPath, "utf-8"));
      expect(noriJson.name).toBe("onboarding-wizard-questionnaire");
      expect(noriJson.version).toBe("1.0.0");

      // Verify NO skills directory exists (wizard doesn't need skills)
      const skillsDir = path.join(wizardPath, "skills");
      const skillsExist = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(skillsExist).toBe(false);

      // Verify NO subagents directory exists
      const subagentsDir = path.join(wizardPath, "subagents");
      const subagentsExist = await fs
        .access(subagentsDir)
        .then(() => true)
        .catch(() => false);
      expect(subagentsExist).toBe(false);
    });

    it("should skip existing profiles and preserve user modifications", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      // First installation
      await profilesLoader.run({ config });

      // Modify a profile (simulate user customization)
      const seniorSwePath = path.join(profilesDir, "senior-swe");
      const customContent = "# My Custom CLAUDE.md\nThis is my customization.";
      await fs.writeFile(path.join(seniorSwePath, "CLAUDE.md"), customContent);

      // Second installation (should skip existing profiles)
      await profilesLoader.run({ config });

      // Verify user modification is preserved
      const claudeMdContent = await fs.readFile(
        path.join(seniorSwePath, "CLAUDE.md"),
        "utf-8",
      );
      expect(claudeMdContent).toBe(customContent);
    });
  });

  describe("uninstall", () => {
    it("should preserve all profiles during uninstall for free installation", async () => {
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

      // Verify all profiles are preserved (profiles are never deleted)
      const seniorSweExistsAfter = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExistsAfter).toBe(true);

      const amolExistsAfter = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExistsAfter).toBe(true);
    });

    it("should preserve all profiles during uninstall for paid installation", async () => {
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

      // Verify all profiles are preserved (profiles are never deleted)
      const seniorSweExistsAfter = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExistsAfter).toBe(true);

      const amolExistsAfter = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExistsAfter).toBe(true);
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

    it("should preserve all profiles including custom ones during uninstall", async () => {
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

      // Verify built-in profiles are also preserved (profiles are never deleted)
      const seniorSweExists = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(true);

      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(true);

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
      // Create nori.json for the profile
      await fs.writeFile(
        path.join(seniorSwePath, "nori.json"),
        JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
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

  describe("nori.json parsing", () => {
    it("should parse valid nori.json with name, version and description", async () => {
      const tempTestDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "nori-json-test-"),
      );

      const noriJson = {
        name: "test-profile",
        version: "1.0.0",
        description: "Test profile description",
      };

      const profilePath = path.join(tempTestDir, "test-profile");
      await fs.mkdir(profilePath, { recursive: true });
      await fs.writeFile(
        path.join(profilePath, "nori.json"),
        JSON.stringify(noriJson, null, 2),
      );

      const { readProfileMetadata } = await import("./metadata.js");
      const result = await readProfileMetadata({ profileDir: profilePath });

      expect(result.name).toBe("test-profile");
      expect(result.version).toBe("1.0.0");
      expect(result.description).toBe("Test profile description");

      await fs.rm(tempTestDir, { recursive: true, force: true });
    });

    it("should fallback to profile.json when nori.json does not exist", async () => {
      const tempTestDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "profile-json-fallback-test-"),
      );

      const profileJson = {
        name: "legacy-profile",
        description: "Legacy profile from profile.json",
      };

      const profilePath = path.join(tempTestDir, "legacy-profile");
      await fs.mkdir(profilePath, { recursive: true });
      await fs.writeFile(
        path.join(profilePath, "profile.json"),
        JSON.stringify(profileJson, null, 2),
      );

      const { readProfileMetadata } = await import("./metadata.js");
      const result = await readProfileMetadata({ profileDir: profilePath });

      expect(result.name).toBe("legacy-profile");
      expect(result.description).toBe("Legacy profile from profile.json");

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

  describe("no mixin composition (inlined profiles)", () => {
    it("should not have _testing.injectConditionalMixins export (removed)", () => {
      // After removing mixin composition, these functions should not exist
      expect(_testing.injectConditionalMixins).toBeUndefined();
    });

    it("should not have _testing.getMixinPaths export (removed)", () => {
      // After removing mixin composition, these functions should not exist
      expect(_testing.getMixinPaths).toBeUndefined();
    });
  });

  describe("skipBuiltinProfiles", () => {
    it("should not install built-in profiles when skipBuiltinProfiles is true", async () => {
      // Create a custom profile that was downloaded from registry (not a built-in)
      const customProfileDir = path.join(profilesDir, "my-registry-profile");
      await fs.mkdir(customProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(customProfileDir, "profile.json"),
        JSON.stringify({
          name: "my-registry-profile",
          description: "Profile downloaded from registry",
        }),
      );
      await fs.writeFile(
        path.join(customProfileDir, "CLAUDE.md"),
        "# My Registry Profile\n",
      );

      const config: Config = {
        installDir: tempDir,
        skipBuiltinProfiles: true,
        agents: {
          "claude-code": { profile: { baseProfile: "my-registry-profile" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify custom profile still exists
      const customExists = await fs
        .access(customProfileDir)
        .then(() => true)
        .catch(() => false);
      expect(customExists).toBe(true);

      // Verify built-in profiles were NOT installed
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

      const productManagerExists = await fs
        .access(path.join(profilesDir, "product-manager"))
        .then(() => true)
        .catch(() => false);
      expect(productManagerExists).toBe(false);
    });

    it("should still configure permissions when skipBuiltinProfiles is true", async () => {
      const settingsPath = path.join(claudeDir, "settings.json");

      // Create a custom profile
      const customProfileDir = path.join(profilesDir, "my-registry-profile");
      await fs.mkdir(customProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(customProfileDir, "profile.json"),
        JSON.stringify({ name: "my-registry-profile" }),
      );
      await fs.writeFile(
        path.join(customProfileDir, "CLAUDE.md"),
        "# My Registry Profile\n",
      );

      const config: Config = {
        installDir: tempDir,
        skipBuiltinProfiles: true,
        agents: {
          "claude-code": { profile: { baseProfile: "my-registry-profile" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify permissions are still configured
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      expect(settings.permissions.additionalDirectories).toContain(profilesDir);
    });

    it("should install built-in profiles when skipBuiltinProfiles is false", async () => {
      const config: Config = {
        installDir: tempDir,
        skipBuiltinProfiles: false,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify built-in profiles were installed
      const seniorSweExists = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(true);

      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(true);
    });

    it("should install built-in profiles when skipBuiltinProfiles is undefined (default behavior)", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
      };

      await profilesLoader.run({ config });

      // Verify built-in profiles were installed (default behavior)
      const seniorSweExists = await fs
        .access(path.join(profilesDir, "senior-swe"))
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(true);
    });
  });
});
