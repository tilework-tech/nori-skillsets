import { describe, it, expect, vi } from "vitest";

import { openclawAgentConfig } from "./agent.js";

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

describe("openclawAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(openclawAgentConfig.name).toBe("openclaw");
    expect(openclawAgentConfig.displayName).toBe("OpenClaw");
    expect(openclawAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = openclawAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.openclaw");
  });

  it("should return correct skills directory path", () => {
    const result = openclawAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.openclaw/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = openclawAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.openclaw/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = openclawAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.openclaw/commands");
  });

  it("should return correct instructions file path", () => {
    const result = openclawAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.openclaw/AGENTS.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = openclawAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should have transcript directory under ~/.openclaw/agents", () => {
    expect(openclawAgentConfig.getTranscriptDirectory?.()).toMatch(
      /\.openclaw[/\\]agents$/,
    );
  });

  it("should have artifact patterns for .openclaw dir and AGENTS.md", () => {
    const patterns = openclawAgentConfig.getArtifactPatterns?.();
    expect(patterns?.dirs).toEqual([".openclaw"]);
    expect(patterns?.files).toEqual(["AGENTS.md"]);
  });
});
