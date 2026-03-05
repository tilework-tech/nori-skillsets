import { describe, it, expect, vi } from "vitest";

import { opencodeAgentConfig } from "./agent.js";

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

describe("opencodeAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(opencodeAgentConfig.name).toBe("opencode");
    expect(opencodeAgentConfig.displayName).toBe("OpenCode");
    expect(opencodeAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = opencodeAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.opencode");
  });

  it("should return correct skills directory path", () => {
    const result = opencodeAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.opencode/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = opencodeAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.opencode/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = opencodeAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.opencode/commands");
  });

  it("should return correct instructions file path", () => {
    const result = opencodeAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.opencode/AGENTS.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = opencodeAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(opencodeAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(opencodeAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
