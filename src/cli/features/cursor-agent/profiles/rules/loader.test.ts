/**
 * Tests for cursor-agent rules loader
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach } from "vitest";

import { rulesLoader } from "@/cli/features/cursor-agent/profiles/rules/loader.js";

import type { Config } from "@/cli/config.js";

describe("cursor-agent rules loader", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "cursor-rules-test-"),
    );

    // Create the profile's rules directory structure that would be installed
    // by the profiles loader (simulating profile installation)
    const profileRulesDir = path.join(
      testInstallDir,
      ".cursor",
      "profiles",
      "amol",
      "rules",
      "using-git-worktrees",
    );
    await fs.mkdir(profileRulesDir, { recursive: true });
    await fs.writeFile(
      path.join(profileRulesDir, "RULE.md"),
      "# Using Git Worktrees\n\nPlaceholder rule content.",
    );
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  const createConfig = (overrides: Partial<Config> = {}): Config => ({
    installDir: testInstallDir,
    agents: { "cursor-agent": { profile: { baseProfile: "amol" } } },
    ...overrides,
  });

  describe("loader metadata", () => {
    test("has correct name", () => {
      expect(rulesLoader.name).toBe("rules");
    });

    test("has description", () => {
      expect(rulesLoader.description).toBeDefined();
      expect(rulesLoader.description.length).toBeGreaterThan(0);
    });
  });

  describe("install", () => {
    test("creates rules directory", async () => {
      const config = createConfig();

      await rulesLoader.install({ config });

      const rulesDir = path.join(testInstallDir, ".cursor", "rules");
      const stat = await fs.stat(rulesDir);
      expect(stat.isDirectory()).toBe(true);
    });

    test("copies rule files from profile", async () => {
      const config = createConfig();

      await rulesLoader.install({ config });

      const rulePath = path.join(
        testInstallDir,
        ".cursor",
        "rules",
        "using-git-worktrees",
        "RULE.md",
      );
      await expect(fs.access(rulePath)).resolves.toBeUndefined();
    });

    test("rule content matches source", async () => {
      const config = createConfig();

      await rulesLoader.install({ config });

      const rulePath = path.join(
        testInstallDir,
        ".cursor",
        "rules",
        "using-git-worktrees",
        "RULE.md",
      );
      const content = await fs.readFile(rulePath, "utf-8");
      expect(content).toContain("Using Git Worktrees");
    });

    test("substitutes template placeholders in rule files", async () => {
      const config = createConfig();

      // Update rule file to include template placeholder
      const profileRulePath = path.join(
        testInstallDir,
        ".cursor",
        "profiles",
        "amol",
        "rules",
        "using-git-worktrees",
        "RULE.md",
      );
      await fs.writeFile(
        profileRulePath,
        "See also: `{{rules_dir}}/other-rule/RULE.md`",
      );

      await rulesLoader.install({ config });

      const rulePath = path.join(
        testInstallDir,
        ".cursor",
        "rules",
        "using-git-worktrees",
        "RULE.md",
      );
      const content = await fs.readFile(rulePath, "utf-8");

      // Should have substituted {{rules_dir}} with actual path
      const expectedRulesDir = path.join(testInstallDir, ".cursor", "rules");
      expect(content).toContain(expectedRulesDir);
      expect(content).not.toContain("{{rules_dir}}");
    });
  });

  describe("uninstall", () => {
    test("removes installed rules", async () => {
      const config = createConfig();

      // First install
      await rulesLoader.install({ config });

      // Then uninstall
      await rulesLoader.uninstall({ config });

      const rulesDir = path.join(testInstallDir, ".cursor", "rules");
      await expect(fs.access(rulesDir)).rejects.toThrow();
    });
  });

  describe("validate", () => {
    test("returns valid when rules are installed", async () => {
      const config = createConfig();

      await rulesLoader.install({ config });

      const result = await rulesLoader.validate!({ config });
      expect(result.valid).toBe(true);
    });

    test("returns invalid when rules directory missing", async () => {
      const config = createConfig();

      const result = await rulesLoader.validate!({ config });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });
});
