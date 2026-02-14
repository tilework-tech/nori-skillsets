/**
 * Tests for Codex path utilities
 * Mirrors claude-code/paths.test.ts but for .codex/ directory
 */

import { describe, it, expect } from "vitest";

import {
  getCodexDir,
  getCodexInstructionsFile,
  getCodexSkillsDir,
  getCodexAgentsDir,
  getCodexCommandsDir,
} from "./paths.js";

describe("Codex paths", () => {
  describe("getCodexDir", () => {
    it("returns .codex directory under installDir", () => {
      expect(getCodexDir({ installDir: "/tmp/project" })).toBe(
        "/tmp/project/.codex",
      );
    });
  });

  describe("getCodexInstructionsFile", () => {
    it("returns AGENTS.md inside .codex directory", () => {
      expect(getCodexInstructionsFile({ installDir: "/tmp/project" })).toBe(
        "/tmp/project/.codex/AGENTS.md",
      );
    });
  });

  describe("getCodexSkillsDir", () => {
    it("returns skills directory inside .codex", () => {
      expect(getCodexSkillsDir({ installDir: "/tmp/project" })).toBe(
        "/tmp/project/.codex/skills",
      );
    });
  });

  describe("getCodexAgentsDir", () => {
    it("returns agents directory inside .codex", () => {
      expect(getCodexAgentsDir({ installDir: "/tmp/project" })).toBe(
        "/tmp/project/.codex/agents",
      );
    });
  });

  describe("getCodexCommandsDir", () => {
    it("returns commands directory inside .codex", () => {
      expect(getCodexCommandsDir({ installDir: "/tmp/project" })).toBe(
        "/tmp/project/.codex/commands",
      );
    });
  });
});
