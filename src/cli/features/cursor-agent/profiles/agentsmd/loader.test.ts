/**
 * Tests for cursor-agent agentsmd loader
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, test, expect, beforeEach, afterEach } from "vitest";

import { agentsMdLoader } from "@/cli/features/cursor-agent/profiles/agentsmd/loader.js";

import type { Config } from "@/cli/config.js";

describe("cursor-agent agentsmd loader", () => {
  let testInstallDir: string;

  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(
      path.join(tmpdir(), "cursor-agentsmd-test-"),
    );

    // Create the profile's AGENTS.md that would be installed by profiles loader
    const profileDir = path.join(testInstallDir, ".cursor", "profiles", "amol");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, "AGENTS.md"),
      "# Amol Profile\n\nPlaceholder AGENTS.md content.",
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
      expect(agentsMdLoader.name).toBe("agentsmd");
    });

    test("has description", () => {
      expect(agentsMdLoader.description).toBeDefined();
      expect(agentsMdLoader.description.length).toBeGreaterThan(0);
    });
  });

  describe("install", () => {
    test("creates AGENTS.md file", async () => {
      const config = createConfig();

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      await expect(fs.access(agentsMdPath)).resolves.toBeUndefined();
    });

    test("adds managed block markers", async () => {
      const config = createConfig();

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
      expect(content).toContain("# END NORI-AI MANAGED BLOCK");
    });

    test("includes profile content in managed block", async () => {
      const config = createConfig();

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("Amol Profile");
    });

    test("preserves existing content outside managed block", async () => {
      const config = createConfig();

      // Create pre-existing AGENTS.md with user content
      await fs.writeFile(
        path.join(testInstallDir, "AGENTS.md"),
        "# My Custom Content\n\nThis should be preserved.\n",
      );

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("My Custom Content");
      expect(content).toContain("This should be preserved.");
      expect(content).toContain("# BEGIN NORI-AI MANAGED BLOCK");
    });

    test("updates existing managed block on reinstall", async () => {
      const config = createConfig();

      // First install
      await agentsMdLoader.install({ config });

      // Modify profile content
      const profileDir = path.join(
        testInstallDir,
        ".cursor",
        "profiles",
        "amol",
      );
      await fs.writeFile(
        path.join(profileDir, "AGENTS.md"),
        "# Updated Amol Profile\n\nNew content.",
      );

      // Reinstall
      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("Updated Amol Profile");
      // Should only have one managed block
      const beginMarkerCount = (
        content.match(/# BEGIN NORI-AI MANAGED BLOCK/g) || []
      ).length;
      expect(beginMarkerCount).toBe(1);
    });

    test("substitutes template placeholders in AGENTS.md", async () => {
      const config = createConfig();

      // Update profile AGENTS.md to include template placeholder
      const profileAgentsMd = path.join(
        testInstallDir,
        ".cursor",
        "profiles",
        "amol",
        "AGENTS.md",
      );
      await fs.writeFile(
        profileAgentsMd,
        "Read `{{rules_dir}}/using-git-worktrees/RULE.md`",
      );

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      // Should have substituted {{rules_dir}} with actual path
      const expectedRulesDir = path.join(testInstallDir, ".cursor", "rules");
      expect(content).toContain(expectedRulesDir);
      expect(content).not.toContain("{{rules_dir}}");
    });
  });

  describe("uninstall", () => {
    test("removes managed block from AGENTS.md", async () => {
      const config = createConfig();

      // First install
      await agentsMdLoader.install({ config });

      // Then uninstall
      await agentsMdLoader.uninstall({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");

      // File should either not exist or not contain managed block
      try {
        const content = await fs.readFile(agentsMdPath, "utf-8");
        expect(content).not.toContain("# BEGIN NORI-AI MANAGED BLOCK");
        expect(content).not.toContain("# END NORI-AI MANAGED BLOCK");
      } catch {
        // File doesn't exist, which is also valid
      }
    });

    test("preserves user content when removing managed block", async () => {
      const config = createConfig();

      // Create pre-existing AGENTS.md with user content
      await fs.writeFile(
        path.join(testInstallDir, "AGENTS.md"),
        "# My Custom Content\n\nThis should be preserved.\n",
      );

      // Install (adds managed block)
      await agentsMdLoader.install({ config });

      // Uninstall (removes managed block)
      await agentsMdLoader.uninstall({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("My Custom Content");
      expect(content).not.toContain("# BEGIN NORI-AI MANAGED BLOCK");
    });
  });

  describe("validate", () => {
    test("returns valid when AGENTS.md has managed block", async () => {
      const config = createConfig();

      await agentsMdLoader.install({ config });

      const result = await agentsMdLoader.validate!({ config });
      expect(result.valid).toBe(true);
    });

    test("returns invalid when AGENTS.md missing", async () => {
      const config = createConfig();

      const result = await agentsMdLoader.validate!({ config });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test("returns invalid when managed block missing", async () => {
      const config = createConfig();

      // Create AGENTS.md without managed block
      await fs.writeFile(
        path.join(testInstallDir, "AGENTS.md"),
        "# Some content without managed block",
      );

      const result = await agentsMdLoader.validate!({ config });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });
});
