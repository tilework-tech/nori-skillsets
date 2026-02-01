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

/**
 * Create a minimal stub profile in the profiles directory.
 * Since built-in profiles are no longer bundled, downstream loaders (claudemd, skills)
 * need a profile with at least a CLAUDE.md file to exist in the profiles directory.
 * @param args - Function arguments
 * @param args.profilesDir - Path to the profiles directory
 * @param args.profileName - Name of the profile to create
 */
const createStubProfile = async (args: {
  profilesDir: string;
  profileName: string;
}): Promise<void> => {
  const { profilesDir, profileName } = args;
  const profileDir = path.join(profilesDir, profileName);
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile\n");
  await fs.writeFile(
    path.join(profileDir, "nori.json"),
    JSON.stringify({
      name: profileName,
      version: "1.0.0",
      description: "Test profile",
    }),
  );
};

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
    it("should create profiles directory and configure permissions", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      // Create stub profile so downstream loaders can find CLAUDE.md
      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

      await profilesLoader.run({ config });

      // Verify profiles directory exists
      const exists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify permissions are configured in settings.json
      const settingsPath = path.join(claudeDir, "settings.json");
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      expect(settings.permissions.additionalDirectories).toContain(profilesDir);
    });

    it("should not copy any built-in profiles into an empty profiles directory", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      // Create stub profile so downstream loaders don't fail
      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

      await profilesLoader.run({ config });

      // Verify only our stub profile exists (no built-in profiles were added)
      const files = await fs.readdir(profilesDir);
      expect(files).toEqual(["test-profile"]);
    });

    it("should handle reinstallation without errors", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

      // First installation
      await profilesLoader.run({ config });

      // Second installation (update)
      await expect(profilesLoader.run({ config })).resolves.not.toThrow();

      // Verify profiles directory still exists
      const exists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should preserve existing user-installed profiles on reinstall", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

      // First installation
      await profilesLoader.run({ config });

      // Simulate user installing another profile
      const userProfile = path.join(profilesDir, "my-custom-profile");
      await fs.mkdir(userProfile, { recursive: true });
      await fs.writeFile(
        path.join(userProfile, "CLAUDE.md"),
        "# Custom Profile",
      );

      // Second installation (update)
      await profilesLoader.run({ config });

      // Verify user profile is preserved
      const customExists = await fs
        .access(userProfile)
        .then(() => true)
        .catch(() => false);
      expect(customExists).toBe(true);

      const content = await fs.readFile(
        path.join(userProfile, "CLAUDE.md"),
        "utf-8",
      );
      expect(content).toBe("# Custom Profile");
    });
  });

  describe("uninstall", () => {
    it("should preserve all profiles during uninstall", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      // Install and add a user profile
      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });
      await profilesLoader.run({ config });

      const userProfile = path.join(profilesDir, "my-profile");
      await fs.mkdir(userProfile, { recursive: true });
      await fs.writeFile(path.join(userProfile, "CLAUDE.md"), "# My Profile");

      // Uninstall profiles
      await profilesLoader.uninstall({ config });

      // Verify profiles are preserved (profiles are never deleted)
      const testProfileExists = await fs
        .access(path.join(profilesDir, "test-profile"))
        .then(() => true)
        .catch(() => false);
      expect(testProfileExists).toBe(true);

      const userProfileExists = await fs
        .access(userProfile)
        .then(() => true)
        .catch(() => false);
      expect(userProfileExists).toBe(true);
    });

    it("should not throw if profiles directory does not exist", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      // Uninstall without installing first
      await expect(profilesLoader.uninstall({ config })).resolves.not.toThrow();
    });
  });

  describe("validate", () => {
    it("should pass validation when profiles directory exists and permissions are configured", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      // Create stub profile and install
      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });
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
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      // Validate without installing
      const result = await profilesLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("should return invalid when permissions are not configured", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      // Create stub profile and install
      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });
      await profilesLoader.run({ config });

      // Manually remove permissions
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
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

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
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

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
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

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
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

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
    });

    it("should remove permissions on uninstall", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

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
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

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
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      await expect(profilesLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should validate permissions configuration", async () => {
      const config: Config = {
        installDir: tempDir,
        agents: {
          "claude-code": { profile: { baseProfile: "test-profile" } },
        },
      };

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

      // Install
      await profilesLoader.run({ config });

      // Validate
      const result = await profilesLoader.validate!({ config });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
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
});
