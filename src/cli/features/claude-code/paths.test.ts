/**
 * Tests for Claude Code path helper functions
 */

import * as os from "os";
import * as path from "path";

import { describe, it, expect } from "vitest";

import {
  getClaudeDir,
  getClaudeSettingsFile,
  getClaudeSkillsDir,
  getClaudeMdFile,
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
  getClaudeHomeCommandsDir,
  // New Nori path helpers
  getNoriDir,
  getNoriProfilesDir,
  getNoriConfigFile,
  getNoriSkillsDir,
  getNoriSkillDir,
} from "./paths.js";

describe("Claude Code paths", () => {
  describe("getClaudeDir", () => {
    it("should return .claude directory under installDir", () => {
      const result = getClaudeDir({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.claude");
    });
  });

  describe("getClaudeSettingsFile", () => {
    it("should return settings.json path under .claude", () => {
      const result = getClaudeSettingsFile({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.claude/settings.json");
    });
  });

  describe("getClaudeSkillsDir", () => {
    it("should return skills directory under .claude", () => {
      const result = getClaudeSkillsDir({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.claude/skills");
    });
  });

  describe("getClaudeMdFile", () => {
    it("should return CLAUDE.md path under .claude", () => {
      const result = getClaudeMdFile({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.claude/CLAUDE.md");
    });
  });

  describe("getClaudeHomeDir", () => {
    it("should return ~/.claude regardless of installDir", () => {
      const result = getClaudeHomeDir();
      expect(result).toBe(path.join(os.homedir(), ".claude"));
    });
  });

  describe("getClaudeHomeSettingsFile", () => {
    it("should return ~/.claude/settings.json", () => {
      const result = getClaudeHomeSettingsFile();
      expect(result).toBe(path.join(os.homedir(), ".claude", "settings.json"));
    });
  });

  describe("getClaudeHomeCommandsDir", () => {
    it("should return ~/.claude/commands", () => {
      const result = getClaudeHomeCommandsDir();
      expect(result).toBe(path.join(os.homedir(), ".claude", "commands"));
    });
  });
});

describe("Nori paths", () => {
  describe("getNoriDir", () => {
    it("should return .nori directory under installDir for project-level installs", () => {
      const result = getNoriDir({ installDir: "/projects/myapp" });
      expect(result).toBe("/projects/myapp/.nori");
    });

    it("should return ~/.nori for home directory installs", () => {
      const homeDir = os.homedir();
      const result = getNoriDir({ installDir: homeDir });
      expect(result).toBe(path.join(homeDir, ".nori"));
    });
  });

  describe("getNoriProfilesDir", () => {
    it("should return profiles directory under .nori for project-level installs", () => {
      const result = getNoriProfilesDir({ installDir: "/projects/myapp" });
      expect(result).toBe("/projects/myapp/.nori/profiles");
    });

    it("should return ~/.nori/profiles for home directory installs", () => {
      const homeDir = os.homedir();
      const result = getNoriProfilesDir({ installDir: homeDir });
      expect(result).toBe(path.join(homeDir, ".nori", "profiles"));
    });
  });

  describe("getNoriConfigFile", () => {
    it("should return config.json under .nori for project-level installs", () => {
      const result = getNoriConfigFile({ installDir: "/projects/myapp" });
      expect(result).toBe("/projects/myapp/.nori/config.json");
    });

    it("should return ~/.nori/config.json for home directory installs", () => {
      const homeDir = os.homedir();
      const result = getNoriConfigFile({ installDir: homeDir });
      expect(result).toBe(path.join(homeDir, ".nori", "config.json"));
    });
  });

  describe("getNoriSkillsDir", () => {
    it("should return skills directory under .nori for project-level installs", () => {
      const result = getNoriSkillsDir({ installDir: "/projects/myapp" });
      expect(result).toBe("/projects/myapp/.nori/skills");
    });

    it("should return ~/.nori/skills for home directory installs", () => {
      const homeDir = os.homedir();
      const result = getNoriSkillsDir({ installDir: homeDir });
      expect(result).toBe(path.join(homeDir, ".nori", "skills"));
    });
  });

  describe("getNoriSkillDir", () => {
    it("should return skill directory under .nori/skills with skill name", () => {
      const result = getNoriSkillDir({
        installDir: "/projects/myapp",
        skillName: "writing-plans",
      });
      expect(result).toBe("/projects/myapp/.nori/skills/writing-plans");
    });

    it("should handle skill names with special characters", () => {
      const result = getNoriSkillDir({
        installDir: "/projects/myapp",
        skillName: "my-awesome-skill",
      });
      expect(result).toBe("/projects/myapp/.nori/skills/my-awesome-skill");
    });
  });
});
