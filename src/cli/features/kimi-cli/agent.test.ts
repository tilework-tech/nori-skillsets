import { describe, it, expect, vi } from "vitest";

import { kimiCliAgentConfig } from "./agent.js";

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

describe("kimiCliAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(kimiCliAgentConfig.name).toBe("kimi-cli");
    expect(kimiCliAgentConfig.displayName).toBe("Kimi CLI");
    expect(kimiCliAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = kimiCliAgentConfig.getAgentDir({ installDir: "/project" });
    expect(result).toBe("/project/.kimi");
  });

  it("should return correct skills directory path", () => {
    const result = kimiCliAgentConfig.getSkillsDir({ installDir: "/project" });
    expect(result).toBe("/project/.kimi/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = kimiCliAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.kimi/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = kimiCliAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.kimi/commands");
  });

  it("should return correct instructions file path", () => {
    const result = kimiCliAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.kimi/AGENTS.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = kimiCliAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(kimiCliAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should not have artifact patterns", () => {
    expect(kimiCliAgentConfig.getArtifactPatterns).toBeUndefined();
  });
});
