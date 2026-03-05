import { describe, it, expect } from "vitest";

import {
  getCodexDir,
  getCodexAgentsMdFile,
  getCodexSkillsDir,
  getCodexCommandsDir,
  getCodexAgentsDir,
} from "./paths.js";

describe("Codex agent paths", () => {
  describe("getCodexDir", () => {
    it("should return .codex directory under installDir", () => {
      const result = getCodexDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.codex");
    });
  });

  describe("getCodexAgentsMdFile", () => {
    it("should return AGENTS.md inside .codex directory", () => {
      const result = getCodexAgentsMdFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.codex/AGENTS.md");
    });
  });

  describe("getCodexSkillsDir", () => {
    it("should return skills directory under .codex", () => {
      const result = getCodexSkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.codex/skills");
    });
  });

  describe("getCodexCommandsDir", () => {
    it("should return commands directory under .codex", () => {
      const result = getCodexCommandsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.codex/commands");
    });
  });

  describe("getCodexAgentsDir", () => {
    it("should return agents directory under .codex", () => {
      const result = getCodexAgentsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.codex/agents");
    });
  });
});
