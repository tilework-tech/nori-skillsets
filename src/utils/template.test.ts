/**
 * Tests for template substitution utility functions
 */

import * as os from "os";
import * as path from "path";

import { describe, it, expect } from "vitest";

import { substituteTemplatePaths, formatInstallPath } from "./template.js";

describe("substituteTemplatePaths", () => {
  describe("skills_dir placeholder", () => {
    it("should replace {{skills_dir}} with absolute path for custom install", () => {
      const content = "Read `{{skills_dir}}/using-skills/SKILL.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe(
        "Read `/project/.claude/skills/using-skills/SKILL.md`",
      );
    });

    it("should replace {{skills_dir}} with tilde notation for home install", () => {
      const content = "Read `{{skills_dir}}/using-skills/SKILL.md`";
      const homeClaudeDir = path.join(os.homedir(), ".claude");
      const result = substituteTemplatePaths({
        content,
        installDir: homeClaudeDir,
      });
      expect(result).toBe("Read `~/.claude/skills/using-skills/SKILL.md`");
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
    it("should replace {{profiles_dir}} with absolute path for custom install", () => {
      const content = "Check `{{profiles_dir}}/amol/CLAUDE.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("Check `/project/.claude/profiles/amol/CLAUDE.md`");
    });

    it("should replace {{profiles_dir}} with tilde notation for home install", () => {
      const content = "Check `{{profiles_dir}}/amol/CLAUDE.md`";
      const homeClaudeDir = path.join(os.homedir(), ".claude");
      const result = substituteTemplatePaths({
        content,
        installDir: homeClaudeDir,
      });
      expect(result).toBe("Check `~/.claude/profiles/amol/CLAUDE.md`");
    });
  });

  describe("commands_dir placeholder", () => {
    it("should replace {{commands_dir}} with absolute path for custom install", () => {
      const content = "See `{{commands_dir}}/sync-noridocs.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("See `/project/.claude/commands/sync-noridocs.md`");
    });
  });

  describe("install_dir placeholder", () => {
    it("should replace {{install_dir}} with absolute path for custom install", () => {
      const content = "Config at `{{install_dir}}/.nori-config.json`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toBe("Config at `/project/.nori-config.json`");
    });

    it("should replace {{install_dir}} with tilde notation for home install", () => {
      const content = "Config at `{{install_dir}}/.nori-config.json`";
      const homeClaudeDir = path.join(os.homedir(), ".claude");
      const result = substituteTemplatePaths({
        content,
        installDir: homeClaudeDir,
      });
      expect(result).toBe("Config at `~/.nori-config.json`");
    });
  });

  describe("mixed placeholders", () => {
    it("should replace all placeholders in one pass", () => {
      const content = `
Read {{skills_dir}}/foo/SKILL.md
Check {{profiles_dir}}/bar
Commands at {{commands_dir}}
`;
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.claude",
      });
      expect(result).toContain("/project/.claude/skills/foo/SKILL.md");
      expect(result).toContain("/project/.claude/profiles/bar");
      expect(result).toContain("/project/.claude/commands");
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
  });
});

describe("formatInstallPath", () => {
  it("should return absolute path for custom install directory", () => {
    const result = formatInstallPath({
      installDir: "/project/.claude",
      subPath: "skills/foo/SKILL.md",
    });
    expect(result).toBe("/project/.claude/skills/foo/SKILL.md");
  });

  it("should return tilde notation for home install directory", () => {
    const homeClaudeDir = path.join(os.homedir(), ".claude");
    const result = formatInstallPath({
      installDir: homeClaudeDir,
      subPath: "skills/foo/SKILL.md",
    });
    expect(result).toBe("~/.claude/skills/foo/SKILL.md");
  });

  it("should handle subPath starting with slash", () => {
    const result = formatInstallPath({
      installDir: "/project/.claude",
      subPath: "/skills/foo/SKILL.md",
    });
    expect(result).toBe("/project/.claude/skills/foo/SKILL.md");
  });

  it("should handle empty subPath", () => {
    const result = formatInstallPath({
      installDir: "/project/.claude",
      subPath: "",
    });
    expect(result).toBe("/project/.claude");
  });
});
