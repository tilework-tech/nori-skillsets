import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath, saveConfig } from "@/cli/config.js";

import { claudeCodeAgent, claudeCodeAgentConfig } from "./agent.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

// Mock paths module to use test directory
vi.mock("@/cli/features/claude-code/paths.js", () => {
  return {
    getClaudeDir: (_args: { installDir: string }) => "/tmp/agent-test-claude",
    getClaudeMdFile: (_args: { installDir: string }) =>
      "/tmp/agent-test-claude/CLAUDE.md",
    getClaudeSkillsDir: (_args: { installDir: string }) =>
      "/tmp/agent-test-claude/skills",
  };
});

vi.mock("@/cli/features/paths.js", () => {
  const testNoriDir = "/tmp/agent-test-nori";
  return {
    getNoriDir: () => testNoriDir,
    getNoriSkillsetsDir: () => `${testNoriDir}/profiles`,
  };
});

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

describe("claudeCodeAgent.isInstalledAtDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-installed-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return true when .claude/.nori-managed exists", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, ".nori-managed"), "senior-swe");

    expect(claudeCodeAgent.isInstalledAtDir({ path: tempDir })).toBe(true);
  });

  it("should return true when .claude/CLAUDE.md contains NORI-AI MANAGED BLOCK (backwards compat)", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "CLAUDE.md"),
      "# BEGIN NORI-AI MANAGED BLOCK\nsome content\n# END NORI-AI MANAGED BLOCK",
    );

    expect(claudeCodeAgent.isInstalledAtDir({ path: tempDir })).toBe(true);
  });

  it("should return false when neither marker exists", () => {
    expect(claudeCodeAgent.isInstalledAtDir({ path: tempDir })).toBe(false);
  });

  it("should return false when .claude/CLAUDE.md exists but has no managed block", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "CLAUDE.md"),
      "# Just some regular content",
    );

    expect(claudeCodeAgent.isInstalledAtDir({ path: tempDir })).toBe(false);
  });
});

describe("claudeCodeAgent.markInstall", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mark-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create .claude/.nori-managed with the skillset name", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    claudeCodeAgent.markInstall({ path: tempDir, skillsetName: "senior-swe" });

    const content = fs.readFileSync(
      path.join(claudeDir, ".nori-managed"),
      "utf-8",
    );
    expect(content).toBe("senior-swe");
  });

  it("should create .claude directory if it does not exist", () => {
    claudeCodeAgent.markInstall({ path: tempDir, skillsetName: "my-profile" });

    const markerPath = path.join(tempDir, ".claude", ".nori-managed");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(fs.readFileSync(markerPath, "utf-8")).toBe("my-profile");
  });

  it("should overwrite existing .nori-managed with new skillset name", () => {
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, ".nori-managed"), "old-profile");

    claudeCodeAgent.markInstall({ path: tempDir, skillsetName: "new-profile" });

    const content = fs.readFileSync(
      path.join(claudeDir, ".nori-managed"),
      "utf-8",
    );
    expect(content).toBe("new-profile");
  });
});

describe("claudeCodeAgent.switchSkillset", () => {
  let tempDir: string;
  const TEST_NORI_DIR = "/tmp/agent-test-nori";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    // Clean up test directories
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}

    // Create profiles directory with a valid profile
    const skillsetDir = path.join(TEST_NORI_DIR, "profiles", "senior-swe");
    fs.mkdirSync(skillsetDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsetDir, "nori.json"),
      JSON.stringify({ name: "senior-swe", version: "1.0.0" }),
    );

    const otherProfileDir = path.join(TEST_NORI_DIR, "profiles", "documenter");
    fs.mkdirSync(otherProfileDir, { recursive: true });
    fs.writeFileSync(
      path.join(otherProfileDir, "nori.json"),
      JSON.stringify({ name: "documenter", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    try {
      fs.rmSync(TEST_NORI_DIR, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  it("should not update config on disk when switching skillsets", async () => {
    // Create existing config
    const configFile = getConfigPath();
    await saveConfig({
      username: "test@example.com",
      organizationUrl: "https://example.tilework.tech",
      refreshToken: "test-refresh-token",
      activeSkillset: "senior-swe",
      installDir: tempDir,
    });

    const configBefore = fs.readFileSync(configFile, "utf-8");

    // Switch skillset via agent
    await claudeCodeAgent.switchSkillset({
      installDir: tempDir,
      skillsetName: "documenter",
    });

    // Config on disk should be completely unchanged — the agent layer
    // no longer owns config persistence
    const configAfter = fs.readFileSync(configFile, "utf-8");
    expect(configAfter).toBe(configBefore);
  });

  it("should validate that the skillset exists", async () => {
    await expect(
      claudeCodeAgent.switchSkillset({
        installDir: tempDir,
        skillsetName: "nonexistent-profile",
      }),
    ).rejects.toThrow("not found");
  });
});

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
