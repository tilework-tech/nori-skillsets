/**
 * Tests for cursor-agent profiles loader
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the paths module to use temp directories
let mockCursorDir = "";

vi.mock("@/cli/features/cursor-agent/paths.js", () => ({
  getCursorDir: () => mockCursorDir,
  getCursorProfilesDir: () => path.join(mockCursorDir, "profiles"),
  getCursorRulesDir: () => path.join(mockCursorDir, "rules"),
  getCursorSubagentsDir: () => path.join(mockCursorDir, "subagents"),
  getCursorAgentsMdFile: () => path.join(mockCursorDir, "AGENTS.md"),
}));

// Import loader after mocking
import {
  profilesLoader,
  _testing,
} from "@/cli/features/cursor-agent/profiles/loader.js";

import type { Config } from "@/cli/config.js";

/**
 * Create a minimal stub profile in the profiles directory.
 * Since built-in profiles are no longer bundled, downstream loaders (agentsmd, rules)
 * need a profile with at least an AGENTS.md file to exist in the profiles directory.
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
  await fs.writeFile(path.join(profileDir, "AGENTS.md"), "# Test Profile\n");
  await fs.writeFile(
    path.join(profileDir, "nori.json"),
    JSON.stringify({
      name: profileName,
      version: "1.0.0",
      description: "Test profile",
    }),
  );
};

describe("cursor-agent profiles loader", () => {
  let tempDir: string;
  let cursorDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-profiles-test-"));
    cursorDir = path.join(tempDir, ".cursor");
    profilesDir = path.join(cursorDir, "profiles");

    // Set mock paths
    mockCursorDir = cursorDir;

    // Create directories
    await fs.mkdir(cursorDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  const createConfig = (overrides: Partial<Config> = {}): Config => ({
    installDir: tempDir,
    agents: { "cursor-agent": { profile: { baseProfile: "test-profile" } } },
    ...overrides,
  });

  describe("loader metadata", () => {
    test("has correct name", () => {
      expect(profilesLoader.name).toBe("profiles");
    });

    test("has description", () => {
      expect(profilesLoader.description).toBeDefined();
      expect(profilesLoader.description.length).toBeGreaterThan(0);
    });
  });

  describe("run (install)", () => {
    test("creates profiles directory", async () => {
      const config = createConfig();

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

      await profilesLoader.run({ config });

      const stat = await fs.stat(profilesDir);
      expect(stat.isDirectory()).toBe(true);
    });

    test("should not copy any built-in profiles", async () => {
      const config = createConfig();

      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });

      await profilesLoader.run({ config });

      // Verify only the stub profile exists (no built-in profiles were added)
      const files = await fs.readdir(profilesDir);
      expect(files).toEqual(["test-profile"]);
    });

    test("should handle reinstallation without errors", async () => {
      const config = createConfig();

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

    test("should preserve existing user-installed profiles on reinstall", async () => {
      const config = createConfig();

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
        path.join(userProfile, "AGENTS.md"),
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
        path.join(userProfile, "AGENTS.md"),
        "utf-8",
      );
      expect(content).toBe("# Custom Profile");
    });
  });

  describe("uninstall", () => {
    test("preserves ALL profiles during uninstall (profiles are never deleted)", async () => {
      const config = createConfig();

      // First install and add a user profile
      await fs.mkdir(profilesDir, { recursive: true });
      await createStubProfile({
        profilesDir,
        profileName: "test-profile",
      });
      await profilesLoader.run({ config });

      const userProfile = path.join(profilesDir, "my-profile");
      await fs.mkdir(userProfile, { recursive: true });
      await fs.writeFile(path.join(userProfile, "AGENTS.md"), "# My Profile");

      // Then uninstall
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

    test("does not throw if profiles directory does not exist", async () => {
      const config = createConfig();

      // Uninstall without installing first
      await expect(profilesLoader.uninstall({ config })).resolves.not.toThrow();
    });
  });

  describe("validate", () => {
    test("returns invalid when profiles directory missing", async () => {
      const config = createConfig();

      const result = await profilesLoader.validate!({ config });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test("returns invalid when profiles directory exists but is empty", async () => {
      const config = createConfig();

      // Create profiles directory but don't add any profiles
      await fs.mkdir(profilesDir, { recursive: true });

      const result = await profilesLoader.validate!({ config });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test("returns valid when profiles directory has at least one profile", async () => {
      const config = createConfig();

      // Create profiles directory with a user-installed profile
      await fs.mkdir(profilesDir, { recursive: true });
      const profileDir = path.join(profilesDir, "my-profile");
      await fs.mkdir(profileDir, { recursive: true });

      const result = await profilesLoader.validate!({ config });
      expect(result.valid).toBe(true);
    });
  });

  describe("_testing exports", () => {
    test("getMixinPaths should be undefined (mixin composition removed)", () => {
      expect(_testing.getMixinPaths).toBeUndefined();
    });
  });
});
