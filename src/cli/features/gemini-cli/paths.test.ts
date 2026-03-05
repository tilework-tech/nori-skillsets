import { describe, it, expect } from "vitest";

import {
  getGeminiDir,
  getGeminiMdFile,
  getGeminiSkillsDir,
  getGeminiCommandsDir,
  getGeminiAgentsDir,
} from "./paths.js";

describe("Gemini CLI agent paths", () => {
  describe("getGeminiDir", () => {
    it("should return .gemini directory under installDir", () => {
      const result = getGeminiDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.gemini");
    });
  });

  describe("getGeminiMdFile", () => {
    it("should return GEMINI.md inside .gemini directory", () => {
      const result = getGeminiMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.gemini/GEMINI.md");
    });
  });

  describe("getGeminiSkillsDir", () => {
    it("should return skills directory under .gemini", () => {
      const result = getGeminiSkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.gemini/skills");
    });
  });

  describe("getGeminiCommandsDir", () => {
    it("should return commands directory under .gemini", () => {
      const result = getGeminiCommandsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.gemini/commands");
    });
  });

  describe("getGeminiAgentsDir", () => {
    it("should return agents directory under .gemini", () => {
      const result = getGeminiAgentsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.gemini/agents");
    });
  });
});
