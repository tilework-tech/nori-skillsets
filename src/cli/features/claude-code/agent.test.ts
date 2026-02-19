import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getConfigPath, saveConfig } from "@/cli/config.js";

import { claudeCodeAgent } from "./agent.js";

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
  const testNoriDir = "/tmp/agent-test-nori";
  return {
    getClaudeDir: (_args: { installDir: string }) => "/tmp/agent-test-claude",
    getClaudeMdFile: (_args: { installDir: string }) =>
      "/tmp/agent-test-claude/CLAUDE.md",
    getClaudeSkillsDir: (_args: { installDir: string }) =>
      "/tmp/agent-test-claude/skills",
    getNoriDir: () => testNoriDir,
    getNoriProfilesDir: () => `${testNoriDir}/profiles`,
    getNoriConfigFile: () => `${testNoriDir}/config.json`,
  };
});

// Mock logger to suppress output during tests
vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  newline: vi.fn(),
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

describe("claudeCodeAgent.switchProfile", () => {
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
    const profileDir = path.join(TEST_NORI_DIR, "profiles", "senior-swe");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, "nori.json"),
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

  it("should preserve organizations, isAdmin, and transcriptDestination when switching profiles", async () => {
    // Create existing config with organizations, isAdmin, and transcriptDestination
    const configFile = getConfigPath();
    await saveConfig({
      username: "test@example.com",
      organizationUrl: "https://example.tilework.tech",
      refreshToken: "test-refresh-token",
      organizations: ["org-alpha", "org-beta"],
      isAdmin: true,
      agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
      version: "20.0.0",
      transcriptDestination: "myorg",
      installDir: tempDir,
    });

    // Switch to a different profile
    await claudeCodeAgent.switchProfile({
      installDir: tempDir,
      profileName: "documenter",
    });

    // Verify organizations, isAdmin, and transcriptDestination are preserved
    const fileContents = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(fileContents.auth.organizations).toEqual(["org-alpha", "org-beta"]);
    expect(fileContents.auth.isAdmin).toBe(true);
    expect(fileContents.transcriptDestination).toBe("myorg");

    // Also verify the profile was actually switched
    expect(fileContents.agents["claude-code"].profile.baseProfile).toBe(
      "documenter",
    );
  });
});
