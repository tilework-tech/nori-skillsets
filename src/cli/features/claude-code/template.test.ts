/**
 * Tests for Claude Code template substitution
 */

import { describe, it, expect } from "vitest";

import { substituteTemplatePaths } from "./template.js";

describe("substituteTemplatePaths", () => {
  describe("skills_dir placeholder", () => {
    it("should replace {{skills_dir}} with absolute path", () => {
      const content = "Read `{{skills_dir}}/using-skills/SKILL.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe(
        "Read `/project/.claude/skills/using-skills/SKILL.md`",
      );
    });

    it("should replace multiple {{skills_dir}} placeholders", () => {
      const content = `
- Read \`{{skills_dir}}/foo/SKILL.md\`
- Read \`{{skills_dir}}/bar/SKILL.md\`
`;
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toContain("/project/.claude/skills/foo/SKILL.md");
      expect(result).toContain("/project/.claude/skills/bar/SKILL.md");
    });
  });

  describe("profiles_dir placeholder", () => {
    it("should replace {{profiles_dir}} with absolute path", () => {
      const content = "Check `{{profiles_dir}}/amol/CLAUDE.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("Check `/project/.claude/profiles/amol/CLAUDE.md`");
    });
  });

  describe("commands_dir placeholder", () => {
    it("should replace {{commands_dir}} with absolute path", () => {
      const content = "See `{{commands_dir}}/nori-sync-docs.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("See `/project/.claude/commands/nori-sync-docs.md`");
    });
  });

  describe("install_dir placeholder", () => {
    it("should replace {{install_dir}} with parent of installDir", () => {
      const content = "Config at `{{install_dir}}/.nori-config.json`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("Config at `/project/.nori-config.json`");
    });
  });

  describe("mixed placeholders", () => {
    it("should replace all placeholders in one pass", () => {
      const content = `
Read {{skills_dir}}/foo/SKILL.md
Check {{profiles_dir}}/bar
Commands at {{commands_dir}}
Install root: {{install_dir}}
`;
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toContain("/project/.claude/skills/foo/SKILL.md");
      expect(result).toContain("/project/.claude/profiles/bar");
      expect(result).toContain("/project/.claude/commands");
      expect(result).toContain("Install root: /project");
    });
  });

  describe("edge cases", () => {
    it("should handle content with no placeholders", () => {
      const content = "No placeholders here";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("No placeholders here");
    });

    it("should handle empty content", () => {
      const result = substituteTemplatePaths({
        content: "",
        installDir: "/project/.claude",
      });
      expect(result).toBe("");
    });

    it("should handle home directory install", () => {
      const content = "Skills at {{skills_dir}}";
      const result = substituteTemplatePaths({
        content,
        installDir: "/home/user/.claude",
      });
      expect(result).toBe("Skills at /home/user/.claude/skills");
    });
  });
});
