/**
 * Tests for cursor-agent rules content
 * Verifies that all expected rules exist with proper YAML frontmatter
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { describe, test, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to cursor-agent mixins
const MIXINS_DIR = path.join(__dirname, "..", "config", "_mixins");

/**
 * Parse YAML frontmatter from a RULE.md file
 *
 * @param content - The content of the RULE.md file
 *
 * @returns The parsed frontmatter object or null if no frontmatter found
 */
const parseFrontmatter = (content: string): Record<string, unknown> | null => {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    // Handle quoted strings
    if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
      value = (value as string).slice(1, -1);
    }
    // Handle booleans
    if (value === "true") value = true;
    if (value === "false") value = false;

    frontmatter[key] = value;
  }

  return frontmatter;
};

describe("cursor-agent rules content", () => {
  describe("_base mixin rules", () => {
    const baseMixinDir = path.join(MIXINS_DIR, "_base", "rules");

    // _base should have using-rules rule (creating-rules is excluded)
    const expectedBaseRules = ["using-rules"];

    test("_base mixin rules directory exists", async () => {
      const exists = await fs
        .access(baseMixinDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test.each(expectedBaseRules)(
      "_base mixin has %s rule directory",
      async (ruleName) => {
        const ruleDir = path.join(baseMixinDir, ruleName);
        const exists = await fs
          .access(ruleDir)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      },
    );

    test.each(expectedBaseRules)(
      "_base/%s has RULE.md file",
      async (ruleName) => {
        const rulePath = path.join(baseMixinDir, ruleName, "RULE.md");
        const exists = await fs
          .access(rulePath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      },
    );

    test.each(expectedBaseRules)(
      "_base/%s has valid YAML frontmatter with description",
      async (ruleName) => {
        const rulePath = path.join(baseMixinDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.description).toBeDefined();
        expect(typeof frontmatter?.description).toBe("string");
        expect((frontmatter?.description as string).length).toBeGreaterThan(0);
      },
    );

    test.each(expectedBaseRules)(
      "_base/%s has alwaysApply: false",
      async (ruleName) => {
        const rulePath = path.join(baseMixinDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.alwaysApply).toBe(false);
      },
    );
  });

  describe("_swe mixin rules", () => {
    const sweMixinDir = path.join(MIXINS_DIR, "_swe", "rules");

    // All expected _swe rules (mapped from claude-code skills)
    const expectedSweRules = [
      "test-driven-development",
      "finishing-a-development-branch",
      "testing-anti-patterns",
      "brainstorming",
      "systematic-debugging",
      "using-git-worktrees",
      "root-cause-tracing",
      "handle-large-tasks",
      "receiving-code-review",
      "building-ui-ux",
      "writing-plans",
      "using-screenshots",
      "webapp-testing",
    ];

    test("_swe mixin rules directory exists", async () => {
      const exists = await fs
        .access(sweMixinDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test.each(expectedSweRules)(
      "_swe mixin has %s rule directory",
      async (ruleName) => {
        const ruleDir = path.join(sweMixinDir, ruleName);
        const exists = await fs
          .access(ruleDir)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      },
    );

    test.each(expectedSweRules)(
      "_swe/%s has RULE.md file",
      async (ruleName) => {
        const rulePath = path.join(sweMixinDir, ruleName, "RULE.md");
        const exists = await fs
          .access(rulePath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      },
    );

    test.each(expectedSweRules)(
      "_swe/%s has valid YAML frontmatter with description",
      async (ruleName) => {
        const rulePath = path.join(sweMixinDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.description).toBeDefined();
        expect(typeof frontmatter?.description).toBe("string");
        expect((frontmatter?.description as string).length).toBeGreaterThan(0);
      },
    );

    test.each(expectedSweRules)(
      "_swe/%s has alwaysApply: false",
      async (ruleName) => {
        const rulePath = path.join(sweMixinDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.alwaysApply).toBe(false);
      },
    );

    test.each(expectedSweRules)(
      "_swe/%s does not have globs field (uses Apply Intelligently)",
      async (ruleName) => {
        const rulePath = path.join(sweMixinDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.globs).toBeUndefined();
      },
    );
  });

  describe("rule content adaptations", () => {
    const sweMixinDir = path.join(MIXINS_DIR, "_swe", "rules");

    test("rules use {{rules_dir}} instead of {{skills_dir}}", async () => {
      // Check a rule that references other rules
      const systematicDebuggingPath = path.join(
        sweMixinDir,
        "systematic-debugging",
        "RULE.md",
      );

      const exists = await fs
        .access(systematicDebuggingPath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const content = await fs.readFile(systematicDebuggingPath, "utf-8");
        // Should not contain skills_dir
        expect(content).not.toContain("{{skills_dir}}");
        // If it references other rules, should use rules_dir
        if (content.includes("{{")) {
          expect(content).toContain("{{rules_dir}}");
        }
      }
    });

    test("rules do not reference SKILL.md files", async () => {
      const rulesDir = sweMixinDir;
      const ruleNames = await fs.readdir(rulesDir);

      for (const ruleName of ruleNames) {
        const rulePath = path.join(rulesDir, ruleName, "RULE.md");
        try {
          const content = await fs.readFile(rulePath, "utf-8");
          expect(content).not.toContain("SKILL.md");
        } catch {
          // Rule doesn't exist yet - that's fine, other tests will catch it
        }
      }
    });
  });
});
