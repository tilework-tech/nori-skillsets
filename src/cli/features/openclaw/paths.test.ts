import { describe, it, expect } from "vitest";

import {
  getOpenclawDir,
  getOpenclawAgentsMdFile,
  getOpenclawSkillsDir,
  getOpenclawCommandsDir,
  getOpenclawAgentsDir,
} from "./paths.js";

describe("OpenClaw agent paths", () => {
  describe("getOpenclawDir", () => {
    it("should return .openclaw directory under installDir", () => {
      const result = getOpenclawDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.openclaw");
    });
  });

  describe("getOpenclawAgentsMdFile", () => {
    it("should return AGENTS.md inside .openclaw directory", () => {
      const result = getOpenclawAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.openclaw/AGENTS.md");
    });
  });

  describe("getOpenclawSkillsDir", () => {
    it("should return skills directory under .openclaw", () => {
      const result = getOpenclawSkillsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.openclaw/skills");
    });
  });

  describe("getOpenclawCommandsDir", () => {
    it("should return commands directory under .openclaw", () => {
      const result = getOpenclawCommandsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.openclaw/commands");
    });
  });

  describe("getOpenclawAgentsDir", () => {
    it("should return agents directory under .openclaw", () => {
      const result = getOpenclawAgentsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.openclaw/agents");
    });
  });
});
