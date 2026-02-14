/**
 * Tests that profilesLoader delegates to the installProfile pipeline
 * Verifies the migration from ProfileLoaderRegistry to the generic pipeline
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the paths module (same pattern as loader.test.ts)
let mockClaudeDir = "";
let mockNoriDir = "";

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => path.join(mockClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  getNoriDir: () => mockNoriDir,
  getNoriProfilesDir: () => path.join(mockNoriDir, "profiles"),
  getNoriConfigFile: () => path.join(mockNoriDir, "config.json"),
}));

// Mock installProfile to track calls
vi.mock("@/cli/features/pipeline/installProfile.js", () => ({
  installProfile: vi.fn().mockResolvedValue(undefined),
}));

import { installProfile } from "@/cli/features/pipeline/installProfile.js";

import type { Config } from "@/cli/config.js";

import { profilesLoader } from "./loader.js";

describe("profilesLoader pipeline delegation", () => {
  let tempDir: string;
  let claudeDir: string;
  let noriDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "profiles-pipeline-test-"),
    );
    claudeDir = path.join(tempDir, ".claude");
    noriDir = path.join(tempDir, ".nori");
    profilesDir = path.join(noriDir, "profiles");

    mockClaudeDir = claudeDir;
    mockNoriDir = noriDir;

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(noriDir, { recursive: true });

    vi.mocked(installProfile).mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should call installProfile with correct agent name and profile", async () => {
    const config: Config = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "test-profile" } },
      },
    };

    await fs.mkdir(profilesDir, { recursive: true });
    const profileDir = path.join(profilesDir, "test-profile");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile\n");
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );

    await profilesLoader.run({ config });

    expect(installProfile).toHaveBeenCalledWith({
      agentName: "claude-code",
      profileName: "test-profile",
      installDir: tempDir,
    });
  });

  it("should call installProfile exactly once", async () => {
    const config: Config = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "my-skillset" } },
      },
    };

    await fs.mkdir(profilesDir, { recursive: true });
    const profileDir = path.join(profilesDir, "my-skillset");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# My Skillset\n");
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "my-skillset", version: "1.0.0" }),
    );

    await profilesLoader.run({ config });

    expect(installProfile).toHaveBeenCalledTimes(1);
  });

  it("should still configure profiles directory permissions", async () => {
    const config: Config = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "test-profile" } },
      },
    };

    await fs.mkdir(profilesDir, { recursive: true });
    const profileDir = path.join(profilesDir, "test-profile");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile\n");
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );

    await profilesLoader.run({ config });

    // Permissions should still be configured even though installProfile is mocked
    const settingsPath = path.join(claudeDir, "settings.json");
    const content = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(content);

    expect(settings.permissions.additionalDirectories).toContain(profilesDir);
  });

  it("should configure skills directory permissions after pipeline", async () => {
    const config: Config = {
      installDir: tempDir,
      agents: {
        "claude-code": { profile: { baseProfile: "test-profile" } },
      },
    };

    await fs.mkdir(profilesDir, { recursive: true });
    const profileDir = path.join(profilesDir, "test-profile");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, "CLAUDE.md"), "# Test Profile\n");
    await fs.writeFile(
      path.join(profileDir, "nori.json"),
      JSON.stringify({ name: "test-profile", version: "1.0.0" }),
    );

    await profilesLoader.run({ config });

    // Skills directory should be in permissions
    const settingsPath = path.join(claudeDir, "settings.json");
    const content = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(content);

    const skillsDir = path.join(claudeDir, "skills");
    expect(settings.permissions.additionalDirectories).toContain(skillsDir);
  });
});
