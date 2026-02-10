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
