import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { codexAgentConfig } from "./agent.js";

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

describe("codexAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(codexAgentConfig.name).toBe("codex");
    expect(codexAgentConfig.displayName).toBe("Codex");
    expect(codexAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = codexAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.codex");
  });

  it("should return correct skills directory path", () => {
    const result = codexAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.codex/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = codexAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.codex/agents");
  });

  it("should return .codex/prompts for slashcommands (codex reads ~/.codex/prompts/)", () => {
    const result = codexAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.codex/prompts");
  });

  describe("getInstructionsFilePath", () => {
    const ORIGINAL_ENV = process.env.NORI_GLOBAL_CONFIG;

    beforeEach(() => {
      process.env.NORI_GLOBAL_CONFIG = "/home/user";
    });

    afterEach(() => {
      if (ORIGINAL_ENV == null) {
        delete process.env.NORI_GLOBAL_CONFIG;
      } else {
        process.env.NORI_GLOBAL_CONFIG = ORIGINAL_ENV;
      }
    });

    it("should return project-root AGENTS.md for project installs", () => {
      const result = codexAgentConfig.getInstructionsFilePath({
        installDir: "/project",
      });
      expect(result).toBe("/project/AGENTS.md");
    });

    it("should return ~/.codex/AGENTS.md when installDir is the home directory", () => {
      const result = codexAgentConfig.getInstructionsFilePath({
        installDir: "/home/user",
      });
      expect(result).toBe("/home/user/.codex/AGENTS.md");
    });

    it("should treat trailing-slash home dir as a global install", () => {
      const result = codexAgentConfig.getInstructionsFilePath({
        installDir: "/home/user/",
      });
      expect(result).toBe("/home/user/.codex/AGENTS.md");
    });
  });

  it("should return loaders including all expected names", () => {
    const loaders = codexAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(codexAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(codexAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
