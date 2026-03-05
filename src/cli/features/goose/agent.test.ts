import { describe, it, expect, vi } from "vitest";

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
  it("should have correct name, displayName, and description", () => {
    expect(gooseAgentConfig.name).toBe("goose");
    expect(gooseAgentConfig.displayName).toBe("Goose");
    expect(gooseAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = gooseAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.goose");
  });

  it("should return correct skills directory path", () => {
    const result = gooseAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.goose/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = gooseAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.goose/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = gooseAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.goose/commands");
  });

  it("should return correct instructions file path", () => {
    const result = gooseAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.goose/AGENTS.md");
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

  it("should have artifact patterns for .goose dir and AGENTS.md", () => {
    const patterns = gooseAgentConfig.getArtifactPatterns?.();
    expect(patterns?.dirs).toEqual([".goose"]);
    expect(patterns?.files).toEqual(["AGENTS.md"]);
  });
});
