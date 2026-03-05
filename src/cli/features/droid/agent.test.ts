import { describe, it, expect, vi } from "vitest";

import { droidAgentConfig } from "./agent.js";

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

describe("droidAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(droidAgentConfig.name).toBe("droid");
    expect(droidAgentConfig.displayName).toBe("Droid");
    expect(droidAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = droidAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.factory");
  });

  it("should return correct skills directory path", () => {
    const result = droidAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.factory/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = droidAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.factory/droids");
  });

  it("should return correct slashcommands directory path", () => {
    const result = droidAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.factory/commands");
  });

  it("should return correct instructions file path", () => {
    const result = droidAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.factory/AGENTS.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = droidAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(droidAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(droidAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
