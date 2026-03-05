import { describe, it, expect, vi } from "vitest";

import { geminiCliAgentConfig } from "./agent.js";

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

describe("geminiCliAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(geminiCliAgentConfig.name).toBe("gemini-cli");
    expect(geminiCliAgentConfig.displayName).toBe("Gemini CLI");
    expect(geminiCliAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = geminiCliAgentConfig.getAgentDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.gemini");
  });

  it("should return correct skills directory path", () => {
    const result = geminiCliAgentConfig.getSkillsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.gemini/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = geminiCliAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.gemini/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = geminiCliAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.gemini/commands");
  });

  it("should return correct instructions file path", () => {
    const result = geminiCliAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.gemini/GEMINI.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = geminiCliAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should have transcript directory under ~/.gemini/tmp", () => {
    expect(geminiCliAgentConfig.getTranscriptDirectory?.()).toMatch(
      /\.gemini[/\\]tmp$/,
    );
  });

  it("should have artifact patterns for .gemini dir and GEMINI.md", () => {
    const patterns = geminiCliAgentConfig.getArtifactPatterns?.();
    expect(patterns?.dirs).toEqual([".gemini"]);
    expect(patterns?.files).toEqual(["GEMINI.md"]);
  });
});
