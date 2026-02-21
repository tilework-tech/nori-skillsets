/**
 * Tests for skillsets feature loader
 * Verifies install operations
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
  getClaudeSkillsetsDir: () => path.join(mockClaudeDir, "profiles"),
  // New Nori paths
  getNoriDir: () => mockNoriDir,
  getNoriSkillsetsDir: () => path.join(mockNoriDir, "profiles"),
  getNoriConfigFile: () => path.join(mockNoriDir, "config.json"),
}));

// Import loader after mocking env
import { profilesLoader, _testing } from "./loader.js";

/**
 * Create a minimal stub skillset in the profiles directory.
 * Since built-in profiles are no longer bundled, downstream loaders (claudemd, skills)
 * need a profile with at least a CLAUDE.md file to exist in the profiles directory.
 * @param args - Function arguments
 * @param args.skillsetsDir - Path to the profiles directory
 * @param args.skillsetName - Name of the skillset to create
 */
const createStubSkillset = async (args: {
  skillsetsDir: string;
  skillsetName: string;
}): Promise<void> => {
  const { skillsetsDir, skillsetName } = args;
  const skillsetDir = path.join(skillsetsDir, skillsetName);
  await fs.mkdir(skillsetDir, { recursive: true });
  await fs.writeFile(path.join(skillsetDir, "CLAUDE.md"), "# Test Profile\n");
  await fs.writeFile(
    path.join(skillsetDir, "nori.json"),
    JSON.stringify({
      name: skillsetName,
      version: "1.0.0",
      description: "Test profile",
    }),
  );
};

describe("profilesLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let noriDir: string;
  let skillsetsDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "profiles-test-"));
    claudeDir = path.join(tempDir, ".claude");
    noriDir = path.join(tempDir, ".nori");
    skillsetsDir = path.join(noriDir, "profiles");

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
        activeSkillset: "test-profile",
      };

      // Create stub profile so downstream loaders can find CLAUDE.md
      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
      });

      await profilesLoader.run({ config });

      // Verify profiles directory exists
      const exists = await fs
        .access(skillsetsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify permissions are configured in settings.json
      const settingsPath = path.join(claudeDir, "settings.json");
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      expect(settings.permissions.additionalDirectories).toContain(
        skillsetsDir,
      );
    });

    it("should not copy any built-in skillsets into an empty profiles directory", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "test-profile",
      };

      // Create stub profile so downstream loaders don't fail
      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
      });

      await profilesLoader.run({ config });

      // Verify only our stub skillset exists (no built-in skillsets were added)
      const files = await fs.readdir(skillsetsDir);
      expect(files).toEqual(["test-profile"]);
    });

    it("should handle reinstallation without errors", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "test-profile",
      };

      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
      });

      // First installation
      await profilesLoader.run({ config });

      // Second installation (update)
      await expect(profilesLoader.run({ config })).resolves.not.toThrow();

      // Verify profiles directory still exists
      const exists = await fs
        .access(skillsetsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should preserve existing user-installed skillsets on reinstall", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "test-profile",
      };

      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
      });

      // First installation
      await profilesLoader.run({ config });

      // Simulate user installing another skillset
      const userProfile = path.join(skillsetsDir, "my-custom-profile");
      await fs.mkdir(userProfile, { recursive: true });
      await fs.writeFile(
        path.join(userProfile, "nori.json"),
        JSON.stringify({ name: "my-custom-profile", version: "1.0.0" }),
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
        path.join(userProfile, "nori.json"),
        "utf-8",
      );
      expect(JSON.parse(content).name).toBe("my-custom-profile");
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

      const skillsetPath = path.join(tempTestDir, "test-profile");
      await fs.mkdir(skillsetPath, { recursive: true });
      await fs.writeFile(
        path.join(skillsetPath, "nori.json"),
        JSON.stringify(noriJson, null, 2),
      );

      const { readSkillsetMetadata } = await import("./metadata.js");
      const result = await readSkillsetMetadata({ skillsetDir: skillsetPath });

      expect(result.name).toBe("test-profile");
      expect(result.version).toBe("1.0.0");
      expect(result.description).toBe("Test profile description");

      await fs.rm(tempTestDir, { recursive: true, force: true });
    });

    it("should throw when nori.json does not exist", async () => {
      const tempTestDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "no-nori-json-test-"),
      );

      const skillsetPath = path.join(tempTestDir, "missing-metadata");
      await fs.mkdir(skillsetPath, { recursive: true });

      const { readSkillsetMetadata } = await import("./metadata.js");
      await expect(
        readSkillsetMetadata({ skillsetDir: skillsetPath }),
      ).rejects.toThrow();

      await fs.rm(tempTestDir, { recursive: true, force: true });
    });
  });

  describe("permissions configuration", () => {
    it("should configure permissions.additionalDirectories in settings.json", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "test-profile",
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
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
      expect(settings.permissions.additionalDirectories).toContain(
        skillsetsDir,
      );
    });

    it("should preserve existing settings when adding permissions", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "test-profile",
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
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
      expect(settings.permissions.additionalDirectories).toContain(
        skillsetsDir,
      );
    });

    it("should not duplicate profiles directory in additionalDirectories", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "test-profile",
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
      });

      // Install profiles twice
      await profilesLoader.run({ config });
      await profilesLoader.run({ config });

      // Verify no duplicates
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      const count = settings.permissions.additionalDirectories.filter(
        (dir: string) => dir === skillsetsDir,
      ).length;

      expect(count).toBe(1);
    });

    it("should preserve existing additionalDirectories when adding profiles directory", async () => {
      const config: Config = {
        installDir: tempDir,
        activeSkillset: "test-profile",
      };
      const settingsPath = path.join(claudeDir, "settings.json");

      await fs.mkdir(skillsetsDir, { recursive: true });
      await createStubSkillset({
        skillsetsDir,
        skillsetName: "test-profile",
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
      expect(settings.permissions.additionalDirectories).toContain(
        skillsetsDir,
      );
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
