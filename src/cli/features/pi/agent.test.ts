import { describe, it, expect, vi } from "vitest";

import { piAgentConfig } from "./agent.js";

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

describe("piAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(piAgentConfig.name).toBe("pi");
    expect(piAgentConfig.displayName).toBe("Pi");
    expect(piAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = piAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.pi");
  });

  it("should return correct skills directory path", () => {
    const result = piAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.pi/agent/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = piAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.pi/agent/subagents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = piAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.pi/commands");
  });

  it("should return correct instructions file path", () => {
    const result = piAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.pi/AGENTS.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = piAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(piAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(piAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
