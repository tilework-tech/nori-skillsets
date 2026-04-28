import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { gooseAgentConfig } from "./agent.js";

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

describe("gooseAgentConfig", () => {
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

  it("should have correct name, displayName, and description", () => {
    expect(gooseAgentConfig.name).toBe("goose");
    expect(gooseAgentConfig.displayName).toBe("Goose");
    expect(gooseAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  describe("getAgentDir", () => {
    it("should return ~/.config/goose for global installs", () => {
      const result = gooseAgentConfig.getAgentDir({ installDir: "/home/user" });
      expect(result).toBe("/home/user/.config/goose");
    });

    it("should return <installDir>/.goose for project installs", () => {
      const result = gooseAgentConfig.getAgentDir({ installDir: "/project" });
      expect(result).toBe("/project/.goose");
    });
  });

  describe("getSkillsDir", () => {
    it("should return ~/.config/goose/skills for global installs", () => {
      const result = gooseAgentConfig.getSkillsDir({
        installDir: "/home/user",
      });
      expect(result).toBe("/home/user/.config/goose/skills");
    });

    it("should return <installDir>/.goose/skills for project installs", () => {
      const result = gooseAgentConfig.getSkillsDir({ installDir: "/project" });
      expect(result).toBe("/project/.goose/skills");
    });
  });

  describe("getSubagentsDir", () => {
    it("should return <installDir>/.goose/agents for project installs", () => {
      const result = gooseAgentConfig.getSubagentsDir({
        installDir: "/project",
      });
      expect(result).toBe("/project/.goose/agents");
    });
  });

  describe("getSlashcommandsDir", () => {
    it("should return <installDir>/.goose/commands for project installs", () => {
      const result = gooseAgentConfig.getSlashcommandsDir({
        installDir: "/project",
      });
      expect(result).toBe("/project/.goose/commands");
    });
  });

  describe("getInstructionsFilePath", () => {
    it("should return project-root AGENTS.md for project installs", () => {
      const result = gooseAgentConfig.getInstructionsFilePath({
        installDir: "/project",
      });
      expect(result).toBe("/project/AGENTS.md");
    });

    it("should return ~/.config/goose/AGENTS.md when installDir is the home directory", () => {
      const result = gooseAgentConfig.getInstructionsFilePath({
        installDir: "/home/user",
      });
      expect(result).toBe("/home/user/.config/goose/AGENTS.md");
    });

    it("should treat trailing-slash home dir as a global install", () => {
      const result = gooseAgentConfig.getInstructionsFilePath({
        installDir: "/home/user/",
      });
      expect(result).toBe("/home/user/.config/goose/AGENTS.md");
    });
  });

  it("should return loaders including all expected names", () => {
    const loaders = gooseAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(gooseAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(gooseAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
