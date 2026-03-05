import { describe, it, expect } from "vitest";

import {
  getOpencodeDir,
  getOpencodeAgentsMdFile,
  getOpencodeSkillsDir,
  getOpencodeCommandsDir,
  getOpencodeAgentsDir,
} from "./paths.js";

describe("OpenCode agent paths", () => {
  describe("getOpencodeDir", () => {
    it("should return .opencode directory under installDir", () => {
      const result = getOpencodeDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.opencode");
    });
  });

  describe("getOpencodeAgentsMdFile", () => {
    it("should return AGENTS.md inside .opencode directory", () => {
      const result = getOpencodeAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.opencode/AGENTS.md");
    });
  });

  describe("getOpencodeSkillsDir", () => {
    it("should return skills directory under .opencode", () => {
      const result = getOpencodeSkillsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.opencode/skills");
    });
  });

  describe("getOpencodeCommandsDir", () => {
    it("should return commands directory under .opencode", () => {
      const result = getOpencodeCommandsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.opencode/commands");
    });
  });

  describe("getOpencodeAgentsDir", () => {
    it("should return agents directory under .opencode", () => {
      const result = getOpencodeAgentsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.opencode/agents");
    });
  });
});
