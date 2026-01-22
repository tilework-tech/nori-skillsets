/**
 * Tests for cursor-agent rules content
 * Verifies that all expected rules exist with proper YAML frontmatter
 * Note: Mixin composition has been removed - all rules are now inlined in profiles
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { describe, test, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to cursor-agent profiles config
const PROFILES_DIR = path.join(__dirname, "..", "config");

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
  // Use senior-swe as the reference profile since it has all SWE rules
  const seniorSweRulesDir = path.join(PROFILES_DIR, "senior-swe", "rules");

  // All expected SWE rules (inlined from former _swe mixin)
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
    "using-rules", // base rule
  ];

  describe("senior-swe profile rules", () => {
    test("rules directory exists", async () => {
      const exists = await fs
        .access(seniorSweRulesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test.each(expectedSweRules)("has %s rule directory", async (ruleName) => {
      const ruleDir = path.join(seniorSweRulesDir, ruleName);
      const exists = await fs
        .access(ruleDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test.each(expectedSweRules)("%s has RULE.md file", async (ruleName) => {
      const rulePath = path.join(seniorSweRulesDir, ruleName, "RULE.md");
      const exists = await fs
        .access(rulePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test.each(expectedSweRules)(
      "%s has valid YAML frontmatter with description",
      async (ruleName) => {
        const rulePath = path.join(seniorSweRulesDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.description).toBeDefined();
        expect(typeof frontmatter?.description).toBe("string");
        expect((frontmatter?.description as string).length).toBeGreaterThan(0);
      },
    );

    test.each(expectedSweRules)(
      "%s has alwaysApply: false",
      async (ruleName) => {
        const rulePath = path.join(seniorSweRulesDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.alwaysApply).toBe(false);
      },
    );

    test.each(expectedSweRules)(
      "%s does not have globs field (uses Apply Intelligently)",
      async (ruleName) => {
        const rulePath = path.join(seniorSweRulesDir, ruleName, "RULE.md");
        const content = await fs.readFile(rulePath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.globs).toBeUndefined();
      },
    );
  });

  describe("rule content adaptations", () => {
    test("rules use {{rules_dir}} instead of {{skills_dir}}", async () => {
      // Check a rule that references other rules
      const systematicDebuggingPath = path.join(
        seniorSweRulesDir,
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
      const ruleNames = await fs.readdir(seniorSweRulesDir);

      for (const ruleName of ruleNames) {
        const rulePath = path.join(seniorSweRulesDir, ruleName, "RULE.md");
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

describe("cursor-agent profiles content", () => {
  // All expected profiles
  const expectedProfiles = ["amol", "senior-swe", "product-manager", "none"];

  describe("profile directories", () => {
    test.each(expectedProfiles)(
      "%s profile directory exists",
      async (profileName) => {
        const profileDir = path.join(PROFILES_DIR, profileName);
        const exists = await fs
          .access(profileDir)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      },
    );

    test.each(expectedProfiles)(
      "%s profile has AGENTS.md file",
      async (profileName) => {
        const agentsMdPath = path.join(PROFILES_DIR, profileName, "AGENTS.md");
        const exists = await fs
          .access(agentsMdPath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      },
    );

    test.each(expectedProfiles)(
      "%s profile has nori.json file",
      async (profileName) => {
        const noriJsonPath = path.join(PROFILES_DIR, profileName, "nori.json");
        const exists = await fs
          .access(noriJsonPath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      },
    );
  });

  describe("nori.json content", () => {
    test.each(expectedProfiles)(
      "%s nori.json has required fields",
      async (profileName) => {
        const noriJsonPath = path.join(PROFILES_DIR, profileName, "nori.json");
        const content = await fs.readFile(noriJsonPath, "utf-8");
        const json = JSON.parse(content);

        expect(json.name).toBe(profileName);
        expect(json.version).toBe("1.0.0");
        expect(json.description).toBeDefined();
        expect(typeof json.description).toBe("string");
        expect(json.description.length).toBeGreaterThan(0);
      },
    );
  });

  describe("AGENTS.md content", () => {
    test.each(expectedProfiles)(
      "%s AGENTS.md is not a placeholder (has substantial content)",
      async (profileName) => {
        const agentsMdPath = path.join(PROFILES_DIR, profileName, "AGENTS.md");
        const content = await fs.readFile(agentsMdPath, "utf-8");
        const lines = content.split("\n");

        // All profiles except 'none' should have substantial content (>20 lines)
        // 'none' is minimal but should still have some content
        if (profileName === "none") {
          expect(lines.length).toBeGreaterThan(0);
        } else {
          expect(lines.length).toBeGreaterThan(20);
        }
      },
    );

    test.each(expectedProfiles)(
      "%s AGENTS.md uses {{rules_dir}} not {{skills_dir}}",
      async (profileName) => {
        const agentsMdPath = path.join(PROFILES_DIR, profileName, "AGENTS.md");
        const content = await fs.readFile(agentsMdPath, "utf-8");

        // Should not contain skills_dir
        expect(content).not.toContain("{{skills_dir}}");
      },
    );

    test.each(expectedProfiles)(
      "%s AGENTS.md references RULE.md not SKILL.md",
      async (profileName) => {
        const agentsMdPath = path.join(PROFILES_DIR, profileName, "AGENTS.md");
        const content = await fs.readFile(agentsMdPath, "utf-8");

        // Should not reference SKILL.md
        expect(content).not.toContain("SKILL.md");
      },
    );
  });

  describe("profile rules directories", () => {
    // Profiles with SWE rules (all except 'none')
    const sweProfiles = ["amol", "senior-swe", "product-manager"];

    test.each(sweProfiles)(
      "%s profile has rules directory with SWE rules",
      async (profileName) => {
        const rulesDir = path.join(PROFILES_DIR, profileName, "rules");
        const exists = await fs
          .access(rulesDir)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);

        // Should have test-driven-development rule
        const tddRuleExists = await fs
          .access(path.join(rulesDir, "test-driven-development"))
          .then(() => true)
          .catch(() => false);
        expect(tddRuleExists).toBe(true);
      },
    );

    test("none profile has rules directory with base rule only", async () => {
      const rulesDir = path.join(PROFILES_DIR, "none", "rules");
      const exists = await fs
        .access(rulesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Should have using-rules rule
      const usingRulesExists = await fs
        .access(path.join(rulesDir, "using-rules"))
        .then(() => true)
        .catch(() => false);
      expect(usingRulesExists).toBe(true);

      // Should NOT have SWE rules like test-driven-development
      const tddRuleExists = await fs
        .access(path.join(rulesDir, "test-driven-development"))
        .then(() => true)
        .catch(() => false);
      expect(tddRuleExists).toBe(false);
    });
  });
});
