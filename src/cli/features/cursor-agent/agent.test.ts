import { describe, it, expect, vi } from "vitest";

import { cursorAgentConfig } from "./agent.js";

// Mock @clack/prompts to suppress output during tests
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

describe("cursorAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(cursorAgentConfig.name).toBe("cursor-agent");
    expect(cursorAgentConfig.displayName).toBe("Cursor");
    expect(cursorAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = cursorAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.cursor");
  });

  it("should return correct skills directory path", () => {
    const result = cursorAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.cursor/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = cursorAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.cursor/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = cursorAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.cursor/commands");
  });

  it("should return correct instructions file path", () => {
    const result = cursorAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.cursor/rules/AGENTS.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = cursorAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(cursorAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(cursorAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
