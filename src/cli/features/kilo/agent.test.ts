import { describe, it, expect, vi } from "vitest";

import { kiloAgentConfig } from "./agent.js";

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

describe("kiloAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(kiloAgentConfig.name).toBe("kilo");
    expect(kiloAgentConfig.displayName).toBe("Kilo Code");
    expect(kiloAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = kiloAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.kilocode");
  });

  it("should return correct skills directory path", () => {
    const result = kiloAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.kilocode/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = kiloAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.kilocode/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = kiloAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.kilocode/commands");
  });

  it("should return correct instructions file path", () => {
    const result = kiloAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.kilocode/rules/AGENTS.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = kiloAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(kiloAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should have artifact patterns for .kilocode dir", () => {
    const patterns = kiloAgentConfig.getArtifactPatterns?.();
    expect(patterns?.dirs).toEqual([".kilocode"]);
    expect(patterns?.files).toEqual([]);
  });
});
