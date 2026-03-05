import { describe, it, expect } from "vitest";

import {
  getKimiDir,
  getKimiAgentsMdFile,
  getKimiSkillsDir,
  getKimiCommandsDir,
  getKimiAgentsDir,
} from "./paths.js";

describe("Kimi CLI agent paths", () => {
  describe("getKimiDir", () => {
    it("should return .kimi directory under installDir", () => {
      const result = getKimiDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.kimi");
    });
  });

  describe("getKimiAgentsMdFile", () => {
    it("should return AGENTS.md inside .kimi directory", () => {
      const result = getKimiAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.kimi/AGENTS.md");
    });
  });

  describe("getKimiSkillsDir", () => {
    it("should return skills directory under .kimi", () => {
      const result = getKimiSkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.kimi/skills");
    });
  });

  describe("getKimiCommandsDir", () => {
    it("should return commands directory under .kimi", () => {
      const result = getKimiCommandsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.kimi/commands");
    });
  });

  describe("getKimiAgentsDir", () => {
    it("should return agents directory under .kimi", () => {
      const result = getKimiAgentsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.kimi/agents");
    });
  });
});
