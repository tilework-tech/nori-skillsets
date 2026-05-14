import { describe, it, expect, vi } from "vitest";

import { clineAgentConfig } from "./agent.js";

vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  note: vi.fn(),
}));

describe("clineAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(clineAgentConfig.name).toBe("cline");
    expect(clineAgentConfig.displayName).toBe("Cline");
    expect(clineAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  describe("getAgentDir", () => {
    it("should return <installDir>/.cline", () => {
      const result = clineAgentConfig.getAgentDir({ installDir: "/project" });
      expect(result).toBe("/project/.cline");
    });
  });

  describe("getSkillsDir", () => {
    it("should return <installDir>/.cline/skills", () => {
      const result = clineAgentConfig.getSkillsDir({ installDir: "/project" });
      expect(result).toBe("/project/.cline/skills");
    });
  });

  describe("getSubagentsDir", () => {
    it("should return <installDir>/.cline/agents", () => {
      const result = clineAgentConfig.getSubagentsDir({
        installDir: "/project",
      });
      expect(result).toBe("/project/.cline/agents");
    });
  });

  describe("getSlashcommandsDir", () => {
    it("should return <installDir>/.cline/commands", () => {
      const result = clineAgentConfig.getSlashcommandsDir({
        installDir: "/project",
      });
      expect(result).toBe("/project/.cline/commands");
    });
  });

  describe("getInstructionsFilePath", () => {
    it("should return <installDir>/.cline/rules/AGENTS.md", () => {
      const result = clineAgentConfig.getInstructionsFilePath({
        installDir: "/project",
      });
      expect(result).toBe("/project/.cline/rules/AGENTS.md");
    });
  });

  it("should return loaders including all expected names", () => {
    const loaders = clineAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should track the rules directory for manifest change detection", () => {
    const loaders = clineAgentConfig.getLoaders();
    const instructionsLoader = loaders.find((l) => l.name === "instructions");
    expect(instructionsLoader?.managedDirs).toContain("rules");
  });

  it("should not have transcript directory", () => {
    expect(clineAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(clineAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
