import { describe, it, expect } from "vitest";

import {
  getCursorDir,
  getCursorAgentsMdFile,
  getCursorSkillsDir,
  getCursorCommandsDir,
  getCursorAgentsDir,
} from "./paths.js";

describe("Cursor agent paths", () => {
  describe("getCursorDir", () => {
    it("should return .cursor directory under installDir", () => {
      const result = getCursorDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.cursor");
    });
  });

  describe("getCursorAgentsMdFile", () => {
    it("should return AGENTS.md inside .cursor/rules directory", () => {
      const result = getCursorAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.cursor/rules/AGENTS.md");
    });
  });

  describe("getCursorSkillsDir", () => {
    it("should return skills directory under .cursor", () => {
      const result = getCursorSkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.cursor/skills");
    });
  });

  describe("getCursorCommandsDir", () => {
    it("should return commands directory under .cursor", () => {
      const result = getCursorCommandsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.cursor/commands");
    });
  });

  describe("getCursorAgentsDir", () => {
    it("should return agents directory under .cursor", () => {
      const result = getCursorAgentsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.cursor/agents");
    });
  });
});
