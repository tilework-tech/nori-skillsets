import { describe, it, expect } from "vitest";

import {
  getGooseDir,
  getGooseAgentsMdFile,
  getGooseSkillsDir,
  getGooseCommandsDir,
  getGooseAgentsDir,
} from "./paths.js";

describe("Goose agent paths", () => {
  describe("getGooseDir", () => {
    it("should return .goose directory under installDir", () => {
      const result = getGooseDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.goose");
    });
  });

  describe("getGooseAgentsMdFile", () => {
    it("should return AGENTS.md inside .goose directory", () => {
      const result = getGooseAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.goose/AGENTS.md");
    });
  });

  describe("getGooseSkillsDir", () => {
    it("should return skills directory under .goose", () => {
      const result = getGooseSkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.goose/skills");
    });
  });

  describe("getGooseCommandsDir", () => {
    it("should return commands directory under .goose", () => {
      const result = getGooseCommandsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.goose/commands");
    });
  });

  describe("getGooseAgentsDir", () => {
    it("should return agents directory under .goose", () => {
      const result = getGooseAgentsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.goose/agents");
    });
  });
});
