/**
 * Tests for Claude Code path helper functions
 */

import * as os from "os";
import * as path from "path";

import { describe, it, expect } from "vitest";

import {
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
  getClaudeHomeCommandsDir,
} from "./paths.js";

describe("Claude Code paths", () => {
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
