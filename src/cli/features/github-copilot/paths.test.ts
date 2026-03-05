import { describe, it, expect } from "vitest";

import {
  getGithubDir,
  getGithubCopilotInstructionsFile,
  getGithubSkillsDir,
  getGithubPromptsDir,
  getGithubAgentsDir,
} from "./paths.js";

describe("GitHub Copilot agent paths", () => {
  describe("getGithubDir", () => {
    it("should return .github directory under installDir", () => {
      const result = getGithubDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.github");
    });
  });

  describe("getGithubCopilotInstructionsFile", () => {
    it("should return copilot-instructions.md inside .github directory", () => {
      const result = getGithubCopilotInstructionsFile({
        installDir: "/home/user/project",
      });
      expect(result).toBe("/home/user/project/.github/copilot-instructions.md");
    });
  });

  describe("getGithubSkillsDir", () => {
    it("should return skills directory under .github", () => {
      const result = getGithubSkillsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.github/skills");
    });
  });

  describe("getGithubPromptsDir", () => {
    it("should return prompts directory under .github", () => {
      const result = getGithubPromptsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.github/prompts");
    });
  });

  describe("getGithubAgentsDir", () => {
    it("should return agents directory under .github", () => {
      const result = getGithubAgentsDir({ installDir: "/home/user/project" });
      expect(result).toBe("/home/user/project/.github/agents");
    });
  });
});
