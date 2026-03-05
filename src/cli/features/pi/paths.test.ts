import { describe, it, expect } from "vitest";

import {
  getPiDir,
  getPiAgentsMdFile,
  getPiSkillsDir,
  getPiCommandsDir,
  getPiAgentsDir,
} from "./paths.js";

describe("Pi agent paths", () => {
  describe("getPiDir", () => {
    it("should return .pi directory under installDir", () => {
      const result = getPiDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.pi");
    });
  });

  describe("getPiAgentsMdFile", () => {
    it("should return AGENTS.md inside .pi directory", () => {
      const result = getPiAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.pi/AGENTS.md");
    });
  });

  describe("getPiSkillsDir", () => {
    it("should return skills directory under .pi", () => {
      const result = getPiSkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.pi/skills");
    });
  });

  describe("getPiCommandsDir", () => {
    it("should return commands directory under .pi", () => {
      const result = getPiCommandsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.pi/commands");
    });
  });

  describe("getPiAgentsDir", () => {
    it("should return agents directory under .pi", () => {
      const result = getPiAgentsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.pi/agents");
    });
  });
});
