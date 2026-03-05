import { describe, it, expect } from "vitest";

import {
  getKilocodeDir,
  getKilocodeAgentsMdFile,
  getKilocodeSkillsDir,
  getKilocodeCommandsDir,
  getKilocodeAgentsDir,
} from "./paths.js";

describe("Kilo Code agent paths", () => {
  describe("getKilocodeDir", () => {
    it("should return .kilocode directory under installDir", () => {
      const result = getKilocodeDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.kilocode");
    });
  });

  describe("getKilocodeAgentsMdFile", () => {
    it("should return AGENTS.md inside .kilocode/rules directory", () => {
      const result = getKilocodeAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.kilocode/rules/AGENTS.md");
    });
  });

  describe("getKilocodeSkillsDir", () => {
    it("should return skills directory under .kilocode", () => {
      const result = getKilocodeSkillsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.kilocode/skills");
    });
  });

  describe("getKilocodeCommandsDir", () => {
    it("should return commands directory under .kilocode", () => {
      const result = getKilocodeCommandsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.kilocode/commands");
    });
  });

  describe("getKilocodeAgentsDir", () => {
    it("should return agents directory under .kilocode", () => {
      const result = getKilocodeAgentsDir({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.kilocode/agents");
    });
  });
});
