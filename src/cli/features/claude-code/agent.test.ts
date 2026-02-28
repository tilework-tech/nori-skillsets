import { describe, it, expect, vi } from "vitest";

import { claudeCodeAgentConfig } from "./agent.js";

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
}));

describe("claudeCodeAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(claudeCodeAgentConfig.name).toBe("claude-code");
    expect(claudeCodeAgentConfig.displayName).toBe("Claude Code");
    expect(claudeCodeAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands, hooks, statusline, watch",
    );
  });

  it("should return correct agent directory path", () => {
    const result = claudeCodeAgentConfig.getAgentDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.claude");
  });

  it("should return correct skills directory path", () => {
    const result = claudeCodeAgentConfig.getSkillsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.claude/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = claudeCodeAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.claude/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = claudeCodeAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.claude/commands");
  });

  it("should return correct instructions file path", () => {
    const result = claudeCodeAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.claude/CLAUDE.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = claudeCodeAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("permissions");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
    expect(loaderNames).toContain("hooks");
    expect(loaderNames).toContain("statusline");
    expect(loaderNames).toContain("announcements");
  });

  it("should return transcript directory ending with .claude/projects", () => {
    expect(claudeCodeAgentConfig.getTranscriptDirectory).toBeDefined();
    const dir = claudeCodeAgentConfig.getTranscriptDirectory!();
    expect(dir).toMatch(/\.claude\/projects$/);
  });

  it("should return artifact patterns with .claude dir and CLAUDE.md file", () => {
    expect(claudeCodeAgentConfig.getArtifactPatterns).toBeDefined();
    const patterns = claudeCodeAgentConfig.getArtifactPatterns!();
    expect(patterns.dirs).toContain(".claude");
    expect(patterns.files).toContain("CLAUDE.md");
  });
});
