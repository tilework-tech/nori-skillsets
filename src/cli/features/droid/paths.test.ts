import { describe, it, expect } from "vitest";

import {
  getFactoryDir,
  getFactoryAgentsMdFile,
  getFactorySkillsDir,
  getFactoryCommandsDir,
  getFactoryDroidsDir,
} from "./paths.js";

describe("Droid agent paths", () => {
  describe("getFactoryDir", () => {
    it("should return .factory directory under installDir", () => {
      const result = getFactoryDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.factory");
    });
  });

  describe("getFactoryAgentsMdFile", () => {
    it("should return AGENTS.md inside .factory directory", () => {
      const result = getFactoryAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.factory/AGENTS.md");
    });
  });

  describe("getFactorySkillsDir", () => {
    it("should return skills directory under .factory", () => {
      const result = getFactorySkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.factory/skills");
    });
  });

  describe("getFactoryCommandsDir", () => {
    it("should return commands directory under .factory", () => {
      const result = getFactoryCommandsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.factory/commands");
    });
  });

  describe("getFactoryDroidsDir", () => {
    it("should return droids directory under .factory", () => {
      const result = getFactoryDroidsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.factory/droids");
    });
  });
});
