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
    profile: { baseProfile: "amol" },
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

    test("should compose profile from mixins when profile has mixins field", async () => {
      const config = createConfig();

      await profilesLoader.run({ config });

      // Verify amol profile has composed content from mixins
      const amolPath = path.join(profilesDir, "amol");
      const amolExists = await fs
        .access(amolPath)
        .then(() => true)
        .catch(() => false);
      expect(amolExists).toBe(true);

      // Verify it has rules directory with content from _swe mixin
      const rulesDir = path.join(amolPath, "rules");
      const rulesExists = await fs
        .access(rulesDir)
        .then(() => true)
        .catch(() => false);
      expect(rulesExists).toBe(true);

      // Verify it has the using-git-worktrees rule from _swe mixin
      const gitWorktreesRule = path.join(rulesDir, "using-git-worktrees");
      const ruleExists = await fs
        .access(gitWorktreesRule)
        .then(() => true)
        .catch(() => false);
      expect(ruleExists).toBe(true);
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
          mixins: { base: {} },
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

  describe("getMixinPaths", () => {
    test("should return mixin paths in alphabetical order", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          swe: {},
          base: {},
        },
      };

      const result = _testing.getMixinPaths({ metadata });

      // Should be sorted alphabetically
      expect(result[0]).toContain("_base");
      expect(result[1]).toContain("_swe");
    });

    test("should prepend underscore to mixin names", () => {
      const metadata = {
        name: "test-profile",
        description: "Test profile",
        mixins: {
          base: {},
        },
      };

      const result = _testing.getMixinPaths({ metadata });

      expect(result[0]).toContain("_base");
      expect(result[0]).not.toContain("__base"); // Not double underscore
    });
  });
});
