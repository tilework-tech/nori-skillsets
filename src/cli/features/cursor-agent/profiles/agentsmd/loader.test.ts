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

  describe("rules list generation", () => {
    test("includes Nori Rules System section when rules exist", async () => {
      const config = createConfig();

      // Create rules directory with a rule
      const rulesDir = path.join(testInstallDir, ".cursor", "rules");
      const ruleDir = path.join(rulesDir, "test-rule");
      await fs.mkdir(ruleDir, { recursive: true });
      await fs.writeFile(
        path.join(ruleDir, "RULE.md"),
        "---\ndescription: A test rule for testing\nalwaysApply: false\n---\n\n# Test Rule\n\nContent here.",
      );

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("# Nori Rules System");
      expect(content).toContain("## Available Rules");
    });

    test("includes rule count in rules list", async () => {
      const config = createConfig();

      // Create rules directory with two rules
      const rulesDir = path.join(testInstallDir, ".cursor", "rules");

      const rule1Dir = path.join(rulesDir, "rule-one");
      await fs.mkdir(rule1Dir, { recursive: true });
      await fs.writeFile(
        path.join(rule1Dir, "RULE.md"),
        "---\ndescription: First rule\nalwaysApply: false\n---\n\n# Rule One",
      );

      const rule2Dir = path.join(rulesDir, "rule-two");
      await fs.mkdir(rule2Dir, { recursive: true });
      await fs.writeFile(
        path.join(rule2Dir, "RULE.md"),
        "---\ndescription: Second rule\nalwaysApply: false\n---\n\n# Rule Two",
      );

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      expect(content).toContain("Found 2 rules:");
    });

    test("includes rule paths and descriptions", async () => {
      const config = createConfig();

      // Create rules directory with a rule
      const rulesDir = path.join(testInstallDir, ".cursor", "rules");
      const ruleDir = path.join(rulesDir, "my-awesome-rule");
      await fs.mkdir(ruleDir, { recursive: true });
      await fs.writeFile(
        path.join(ruleDir, "RULE.md"),
        "---\ndescription: This is an awesome rule for awesome things\nalwaysApply: false\n---\n\n# My Awesome Rule",
      );

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      // Should include the rule path
      expect(content).toContain("my-awesome-rule/RULE.md");
      // Should include the description
      expect(content).toContain("This is an awesome rule for awesome things");
    });

    test("includes reference to using-rules intro file", async () => {
      const config = createConfig();

      // Create rules directory with using-rules and another rule
      const rulesDir = path.join(testInstallDir, ".cursor", "rules");

      const usingRulesDir = path.join(rulesDir, "using-rules");
      await fs.mkdir(usingRulesDir, { recursive: true });
      await fs.writeFile(
        path.join(usingRulesDir, "RULE.md"),
        "---\ndescription: How to use rules\nalwaysApply: false\n---\n\n# Using Rules",
      );

      const otherRuleDir = path.join(rulesDir, "other-rule");
      await fs.mkdir(otherRuleDir, { recursive: true });
      await fs.writeFile(
        path.join(otherRuleDir, "RULE.md"),
        "---\ndescription: Other rule\nalwaysApply: false\n---\n\n# Other",
      );

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      // Should reference the using-rules intro file
      expect(content).toContain("using-rules/RULE.md");
    });

    test("handles missing rules directory gracefully", async () => {
      const config = createConfig();

      // Don't create any rules directory

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      // Should still create AGENTS.md with profile content
      expect(content).toContain("Amol Profile");
      // Should not have rules system section
      expect(content).not.toContain("# Nori Rules System");
    });

    test("handles empty rules directory gracefully", async () => {
      const config = createConfig();

      // Create empty rules directory
      const rulesDir = path.join(testInstallDir, ".cursor", "rules");
      await fs.mkdir(rulesDir, { recursive: true });

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      // Should still create AGENTS.md with profile content
      expect(content).toContain("Amol Profile");
      // Should not have rules system section when no rules exist
      expect(content).not.toContain("# Nori Rules System");
    });

    test("handles rule without front matter", async () => {
      const config = createConfig();

      // Create rules directory with a rule that has no front matter
      const rulesDir = path.join(testInstallDir, ".cursor", "rules");
      const ruleDir = path.join(rulesDir, "no-frontmatter-rule");
      await fs.mkdir(ruleDir, { recursive: true });
      await fs.writeFile(
        path.join(ruleDir, "RULE.md"),
        "# Rule Without Frontmatter\n\nJust content, no YAML.",
      );

      await agentsMdLoader.install({ config });

      const agentsMdPath = path.join(testInstallDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");

      // Should still include the rule (path at minimum)
      expect(content).toContain("# Nori Rules System");
      expect(content).toContain("no-frontmatter-rule/RULE.md");
    });
  });
});
