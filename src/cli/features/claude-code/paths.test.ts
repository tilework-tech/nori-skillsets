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
  getNoriDir,
  getNoriProfilesDir,
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
    it("should always return ~/.nori regardless of any context", () => {
      const result = getNoriDir();
      expect(result).toBe(path.join(os.homedir(), ".nori"));
    });
  });

  describe("getNoriProfilesDir", () => {
    it("should always return ~/.nori/profiles regardless of any context", () => {
      const result = getNoriProfilesDir();
      expect(result).toBe(path.join(os.homedir(), ".nori", "profiles"));
    });
  });
});
