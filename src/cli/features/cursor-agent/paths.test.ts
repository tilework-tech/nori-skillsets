/**
 * Tests for cursor-agent path helpers
 */

import { describe, test, expect } from "vitest";

import {
  getCursorDir,
  getCursorProfilesDir,
  getCursorRulesDir,
  getCursorAgentsMdFile,
  getCursorHooksFile,
  getCursorCommandsDir,
} from "@/cli/features/cursor-agent/paths.js";

describe("cursor-agent paths", () => {
  describe("getCursorDir", () => {
    test("returns .cursor directory under installDir", () => {
      const result = getCursorDir({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.cursor");
    });

    test("handles trailing slash in installDir", () => {
      const result = getCursorDir({ installDir: "/home/user/" });
      expect(result).toBe("/home/user/.cursor");
    });
  });

  describe("getCursorProfilesDir", () => {
    test("returns profiles directory under .cursor", () => {
      const result = getCursorProfilesDir({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.cursor/profiles");
    });
  });

  describe("getCursorRulesDir", () => {
    test("returns rules directory under .cursor", () => {
      const result = getCursorRulesDir({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.cursor/rules");
    });
  });

  describe("getCursorAgentsMdFile", () => {
    test("returns AGENTS.md file path at installDir root", () => {
      const result = getCursorAgentsMdFile({ installDir: "/home/user" });
      expect(result).toBe("/home/user/AGENTS.md");
    });
  });

  describe("getCursorHooksFile", () => {
    test("returns hooks.json file path under .cursor", () => {
      const result = getCursorHooksFile({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.cursor/hooks.json");
    });
  });

  describe("getCursorCommandsDir", () => {
    test("returns commands directory under .cursor", () => {
      const result = getCursorCommandsDir({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.cursor/commands");
    });
  });
});
