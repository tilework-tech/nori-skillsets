import { describe, it, expect, vi } from "vitest";

import { githubCopilotAgentConfig } from "./agent.js";

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

describe("githubCopilotAgentConfig", () => {
  it("should have correct name, displayName, and description", () => {
    expect(githubCopilotAgentConfig.name).toBe("github-copilot");
    expect(githubCopilotAgentConfig.displayName).toBe("GitHub Copilot");
    expect(githubCopilotAgentConfig.description).toBe(
      "Instructions, skills, subagents, commands",
    );
  });

  it("should return correct agent directory path", () => {
    const result = githubCopilotAgentConfig.getAgentDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.github");
  });

  it("should return correct skills directory path", () => {
    const result = githubCopilotAgentConfig.getSkillsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.github/skills");
  });

  it("should return correct subagents directory path", () => {
    const result = githubCopilotAgentConfig.getSubagentsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.github/agents");
  });

  it("should return correct slashcommands directory path", () => {
    const result = githubCopilotAgentConfig.getSlashcommandsDir({
      installDir: "/project",
    });
    expect(result).toBe("/project/.github/prompts");
  });

  it("should return correct instructions file path", () => {
    const result = githubCopilotAgentConfig.getInstructionsFilePath({
      installDir: "/project",
    });
    expect(result).toBe("/project/.github/copilot-instructions.md");
  });

  it("should return loaders including all expected names", () => {
    const loaders = githubCopilotAgentConfig.getLoaders();
    const loaderNames = loaders.map((l) => l.name);

    expect(loaderNames).toContain("config");
    expect(loaderNames).toContain("skills");
    expect(loaderNames).toContain("instructions");
    expect(loaderNames).toContain("slashcommands");
    expect(loaderNames).toContain("subagents");
  });

  it("should not have transcript directory", () => {
    expect(githubCopilotAgentConfig.getTranscriptDirectory).toBeUndefined();
  });

  it("should have artifact patterns for .github dir and copilot-instructions.md", () => {
    const patterns = githubCopilotAgentConfig.getArtifactPatterns?.();
    expect(patterns?.dirs).toEqual([".github"]);
    expect(patterns?.files).toEqual(["copilot-instructions.md"]);
  });
});
