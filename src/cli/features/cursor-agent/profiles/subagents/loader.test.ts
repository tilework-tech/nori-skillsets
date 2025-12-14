/**
 * Tests for cursor-agent subagents loader
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach } from "vitest";

import { subagentsLoader } from "@/cli/features/cursor-agent/profiles/subagents/loader.js";

import type { Config } from "@/cli/config.js";

describe("cursor-agent subagents loader", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "cursor-subagents-test-"),
    );

    // Create the profile's subagents directory structure that would be installed
    // by the profiles loader (simulating profile installation)
    const profileSubagentsDir = path.join(
      testInstallDir,
      ".cursor",
      "profiles",
      "amol",
      "subagents",
    );
    await fs.mkdir(profileSubagentsDir, { recursive: true });
    await fs.writeFile(
      path.join(profileSubagentsDir, "nori-web-search-researcher.md"),
      "# Web Search Researcher\n\nPlaceholder subagent content.",
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
      expect(subagentsLoader.name).toBe("subagents");
    });

    test("has description", () => {
      expect(subagentsLoader.description).toBeDefined();
      expect(subagentsLoader.description.length).toBeGreaterThan(0);
    });
  });

  describe("install", () => {
    test("creates subagents directory", async () => {
      const config = createConfig();

      await subagentsLoader.install({ config });

      const subagentsDir = path.join(testInstallDir, ".cursor", "subagents");
      const stat = await fs.stat(subagentsDir);
      expect(stat.isDirectory()).toBe(true);
    });

    test("copies subagent files from profile", async () => {
      const config = createConfig();

      await subagentsLoader.install({ config });

      const subagentPath = path.join(
        testInstallDir,
        ".cursor",
        "subagents",
        "nori-web-search-researcher.md",
      );
      await expect(fs.access(subagentPath)).resolves.toBeUndefined();
    });

    test("subagent content matches source", async () => {
      const config = createConfig();

      await subagentsLoader.install({ config });

      const subagentPath = path.join(
        testInstallDir,
        ".cursor",
        "subagents",
        "nori-web-search-researcher.md",
      );
      const content = await fs.readFile(subagentPath, "utf-8");
      expect(content).toContain("Web Search Researcher");
    });

    test("skips gracefully when profile has no subagents directory", async () => {
      // Create a profile without subagents
      const profileDir = path.join(
        testInstallDir,
        ".cursor",
        "profiles",
        "none",
      );
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, "AGENTS.md"),
        "# Minimal profile",
      );

      const config = createConfig({
        agents: { "cursor-agent": { profile: { baseProfile: "none" } } },
      });

      // Should not throw
      await expect(
        subagentsLoader.install({ config }),
      ).resolves.toBeUndefined();
    });

    test("substitutes template placeholders in subagent files", async () => {
      const config = createConfig();

      // Update subagent file to include template placeholder
      const profileSubagentPath = path.join(
        testInstallDir,
        ".cursor",
        "profiles",
        "amol",
        "subagents",
        "nori-web-search-researcher.md",
      );
      await fs.writeFile(
        profileSubagentPath,
        "Read: `{{rules_dir}}/some-rule/RULE.md`",
      );

      await subagentsLoader.install({ config });

      const subagentPath = path.join(
        testInstallDir,
        ".cursor",
        "subagents",
        "nori-web-search-researcher.md",
      );
      const content = await fs.readFile(subagentPath, "utf-8");

      // Should have substituted {{rules_dir}} with actual path
      const expectedRulesDir = path.join(testInstallDir, ".cursor", "rules");
      expect(content).toContain(expectedRulesDir);
      expect(content).not.toContain("{{rules_dir}}");
    });
  });

  describe("uninstall", () => {
    test("removes installed subagents", async () => {
      const config = createConfig();

      // First install
      await subagentsLoader.install({ config });

      // Then uninstall
      await subagentsLoader.uninstall({ config });

      const subagentsDir = path.join(testInstallDir, ".cursor", "subagents");
      await expect(fs.access(subagentsDir)).rejects.toThrow();
    });
  });

  describe("validate", () => {
    test("returns valid when subagents are installed", async () => {
      const config = createConfig();

      await subagentsLoader.install({ config });

      const result = await subagentsLoader.validate!({ config });
      expect(result.valid).toBe(true);
    });

    test("returns invalid when subagents directory missing", async () => {
      const config = createConfig();

      const result = await subagentsLoader.validate!({ config });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });
});
