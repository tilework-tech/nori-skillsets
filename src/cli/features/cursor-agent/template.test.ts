/**
 * Tests for Cursor Agent template substitution
 */

import { describe, it, expect } from "vitest";

import { substituteTemplatePaths } from "./template.js";

describe("substituteTemplatePaths", () => {
  describe("rules_dir placeholder", () => {
    it("should replace {{rules_dir}} with absolute path", () => {
      const content = "Read `{{rules_dir}}/using-git-worktrees/RULE.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.cursor",
      });
      expect(result).toBe(
        "Read `/project/.cursor/rules/using-git-worktrees/RULE.md`",
      );
    });

    it("should replace multiple {{rules_dir}} placeholders", () => {
      const content = `
- Read \`{{rules_dir}}/foo/RULE.md\`
- Read \`{{rules_dir}}/bar/RULE.md\`
`;
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.cursor",
      });
      expect(result).toContain("/project/.cursor/rules/foo/RULE.md");
      expect(result).toContain("/project/.cursor/rules/bar/RULE.md");
    });
  });

  describe("profiles_dir placeholder", () => {
    it("should replace {{profiles_dir}} with absolute path", () => {
      const content = "Check `{{profiles_dir}}/amol/AGENTS.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.cursor",
      });
      expect(result).toBe("Check `/project/.cursor/profiles/amol/AGENTS.md`");
    });
  });

  describe("commands_dir placeholder", () => {
    it("should replace {{commands_dir}} with absolute path", () => {
      const content = "See `{{commands_dir}}/nori-info.md`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.cursor",
      });
      expect(result).toBe("See `/project/.cursor/commands/nori-info.md`");
    });
  });

  describe("install_dir placeholder", () => {
    it("should replace {{install_dir}} with parent of installDir", () => {
      const content = "Config at `{{install_dir}}/.nori-config.json`";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.cursor",
      });
      expect(result).toBe("Config at `/project/.nori-config.json`");
    });
  });

  describe("mixed placeholders", () => {
    it("should replace all placeholders in one pass", () => {
      const content = `
Read {{rules_dir}}/foo/RULE.md
Check {{profiles_dir}}/bar
Commands at {{commands_dir}}
Install root: {{install_dir}}
`;
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.cursor",
      });
      expect(result).toContain("/project/.cursor/rules/foo/RULE.md");
      expect(result).toContain("/project/.cursor/profiles/bar");
      expect(result).toContain("/project/.cursor/commands");
      expect(result).toContain("Install root: /project");
    });
  });

  describe("edge cases", () => {
    it("should handle content with no placeholders", () => {
      const content = "No placeholders here";
      const result = substituteTemplatePaths({
        content,
        installDir: "/project/.cursor",
      });
      expect(result).toBe("No placeholders here");
    });

    it("should handle empty content", () => {
      const result = substituteTemplatePaths({
        content: "",
        installDir: "/project/.cursor",
      });
      expect(result).toBe("");
    });

    it("should handle home directory install", () => {
      const content = "Rules at {{rules_dir}}";
      const result = substituteTemplatePaths({
        content,
        installDir: "/home/user/.cursor",
      });
      expect(result).toBe("Rules at /home/user/.cursor/rules");
    });
  });
});
