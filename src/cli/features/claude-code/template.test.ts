/**
 * Tests for Claude Code template substitution
 */

import * as os from "os";
import * as path from "path";

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
    it("should replace {{profiles_dir}} with ~/.nori/profiles regardless of installDir", () => {
      const content = "Check `{{profiles_dir}}/amol/CLAUDE.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      // Profiles are always in ~/.nori/profiles
      const expectedProfilesDir = path.join(os.homedir(), ".nori", "profiles");
      expect(result).toBe(`Check \`${expectedProfilesDir}/amol/CLAUDE.md\``);
    });
  });

  describe("commands_dir placeholder", () => {
    it("should replace {{commands_dir}} with absolute path", () => {
      const content = "See `{{commands_dir}}/nori-init-docs.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("See `/project/.claude/commands/nori-init-docs.md`");
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
      const expectedProfilesDir = path.join(os.homedir(), ".nori", "profiles");
      expect(result).toContain("/project/.claude/skills/foo/SKILL.md");
      // Profiles are always in ~/.nori/profiles
      expect(result).toContain(`${expectedProfilesDir}/bar`);
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

  describe("escaped variables (backtick-wrapped)", () => {
    it("should not substitute variables wrapped in backticks", () => {
      const content = "Use `{{skills_dir}}` in your skill content";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("Use `{{skills_dir}}` in your skill content");
    });

    it("should substitute unescaped but preserve escaped in same content", () => {
      const content =
        "Skills at {{skills_dir}}, document `{{skills_dir}}` as variable";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe(
        "Skills at /project/.claude/skills, document `{{skills_dir}}` as variable",
      );
    });

    it("should handle multiple escaped variables", () => {
      const content =
        "Use `{{skills_dir}}` and `{{install_dir}}` in your content";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe(
        "Use `{{skills_dir}}` and `{{install_dir}}` in your content",
      );
    });

    it("should handle escaped variables with surrounding text", () => {
      const content = `
These variables are automatically substituted:
- \`{{skills_dir}}\` → actual path to skills directory
- \`{{install_dir}}\` → actual install directory

Example: {{skills_dir}}/my-skill/SKILL.md
`;
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toContain("`{{skills_dir}}`");
      expect(result).toContain("`{{install_dir}}`");
      expect(result).toContain("/project/.claude/skills/my-skill/SKILL.md");
    });

    it("should preserve unknown escaped variables", () => {
      const content = "Use `{{unknown_var}}` for something";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("Use `{{unknown_var}}` for something");
    });
  });
});
