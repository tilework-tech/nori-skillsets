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
    agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
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

      await profilesLoader.run({ config });

      const stat = await fs.stat(profilesDir);
      expect(stat.isDirectory()).toBe(true);
    });

    test("installs amol profile with AGENTS.md", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      const agentsMdPath = path.join(profilesDir, "amol", "AGENTS.md");
      await expect(fs.access(agentsMdPath)).resolves.toBeUndefined();
    });

    test("should not install internal profiles (starting with _)", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      // Verify profiles directory exists
      const files = await fs.readdir(profilesDir);

      // Verify no profiles starting with _ are installed
      const internalProfiles = files.filter((f) => f.startsWith("_"));
      expect(internalProfiles).toHaveLength(0);
    });

    test("should install profile with all content inlined directly", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      // Verify amol profile has all content
      const amolPath = path.join(profilesDir, "amol");
      const amolExists = await fs
        .access(amolPath)
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(true);

      // Verify it has rules directory with inlined content
      const rulesDir = path.join(amolPath, "rules");
      const rulesExists = await fs
        .access(rulesDir)
        .then(() => true)
        .catch(() => false);
      expect(rulesExists).toBe(true);

      // Verify it has the using-git-worktrees rule (inlined from former _swe mixin)
      const gitWorktreesRule = path.join(rulesDir, "using-git-worktrees");
      const ruleExists = await fs
        .access(gitWorktreesRule)
        .then(() => true)
        .catch(() => false);
      expect(ruleExists).toBe(true);

      // Verify profile.json does NOT have a mixins field (mixin composition removed)
      const profileJsonPath = path.join(amolPath, "profile.json");
      const profileJson = JSON.parse(
        await fs.readFile(profileJsonPath, "utf-8"),
      );
      expect(profileJson.mixins).toBeUndefined();
    });
  });

  describe("uninstall", () => {
    test("removes built-in profiles", async () => {
      const config = createConfig();

      // First install
      await profilesLoader.run({ config });

      // Verify profile exists
      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(true);

      // Then uninstall
      await profilesLoader.uninstall({ config });

      // Verify built-in profile was removed
      const amolExistsAfter = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExistsAfter).toBe(false);
    });

    test("preserves custom user profiles during uninstall", async () => {
      const config = createConfig();

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
        }),
      );
      await fs.writeFile(
        path.join(customProfileDir, "AGENTS.md"),
        "# My Custom Profile\n",
      );

      // Verify both profiles exist before uninstall
      const filesBeforeUninstall = await fs.readdir(profilesDir);
      expect(filesBeforeUninstall).toContain("amol");
      expect(filesBeforeUninstall).toContain("my-custom-profile");

      // Uninstall
      await profilesLoader.uninstall({ config });

      // Verify custom profile still exists
      const customExists = await fs
        .access(customProfileDir)
        .then(() => true)
        .catch(() => false);
      expect(customExists).toBe(true);

      // Verify built-in profile is removed
      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(false);
    });

    test("does not throw if profiles directory does not exist", async () => {
      const config = createConfig();

      // Uninstall without installing first
      await expect(profilesLoader.uninstall({ config })).resolves.not.toThrow();
    });
  });

  describe("validate", () => {
    test("returns valid when profiles are installed", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      const result = await profilesLoader.validate!({ config });
      expect(result.valid).toBe(true);
    });

    test("returns invalid when profiles directory missing", async () => {
      const config = createConfig();

      const result = await profilesLoader.validate!({ config });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe("_testing exports", () => {
    test("getMixinPaths should be undefined (mixin composition removed)", () => {
      expect(_testing.getMixinPaths).toBeUndefined();
    });
  });

  describe("profile content", () => {
    test("should install amol profile with subagents", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      // amol profile should have subagents directory
      const subagentsDir = path.join(profilesDir, "amol", "subagents");
      const subagentsExists = await fs
        .access(subagentsDir)
        .then(() => true)
        .catch(() => false);
      expect(subagentsExists).toBe(true);

      // Should have nori-initial-documenter subagent
      const initialDocumenter = path.join(
        subagentsDir,
        "nori-initial-documenter.md",
      );
      const initialDocumenterExists = await fs
        .access(initialDocumenter)
        .then(() => true)
        .catch(() => false);
      expect(initialDocumenterExists).toBe(true);

      // Should have nori-change-documenter subagent
      const changeDocumenter = path.join(
        subagentsDir,
        "nori-change-documenter.md",
      );
      const changeDocumenterExists = await fs
        .access(changeDocumenter)
        .then(() => true)
        .catch(() => false);
      expect(changeDocumenterExists).toBe(true);
    });

    test("should install amol profile with updating-noridocs rule", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      // amol profile should have updating-noridocs rule
      const updatingNoridocsRule = path.join(
        profilesDir,
        "amol",
        "rules",
        "updating-noridocs",
      );
      const ruleExists = await fs
        .access(updatingNoridocsRule)
        .then(() => true)
        .catch(() => false);
      expect(ruleExists).toBe(true);

      // Should have RULE.md file
      const ruleMdPath = path.join(updatingNoridocsRule, "RULE.md");
      const ruleMdExists = await fs
        .access(ruleMdPath)
        .then(() => true)
        .catch(() => false);
      expect(ruleMdExists).toBe(true);
    });
  });

  describe("skipBuiltinProfiles", () => {
    test("should not install built-in profiles when skipBuiltinProfiles is true", async () => {
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
        path.join(customProfileDir, "AGENTS.md"),
        "# My Registry Profile\n",
      );

      const config = createConfig({
        skipBuiltinProfiles: true,
        agents: {
          "cursor-agent": { profile: { baseProfile: "my-registry-profile" } },
        },
      });

      await profilesLoader.run({ config });

      // Verify custom profile still exists
      const customExists = await fs
        .access(customProfileDir)
        .then(() => true)
        .catch(() => false);
      expect(customExists).toBe(true);

      // Verify built-in profiles were NOT installed
      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(false);
    });

    test("should install built-in profiles when skipBuiltinProfiles is false", async () => {
      const config = createConfig({
        skipBuiltinProfiles: false,
      });

      await profilesLoader.run({ config });

      // Verify built-in profiles were installed
      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(true);
    });

    test("should install built-in profiles when skipBuiltinProfiles is undefined (default behavior)", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      // Verify built-in profiles were installed (default behavior)
      const amolExists = await fs
        .access(path.join(profilesDir, "amol"))
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(true);
    });
  });
});
