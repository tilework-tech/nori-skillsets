import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the CLAUDE_DIR before importing
let testClaudeDir: string;
let testInstallDir: string;

vi.mock("@/cli/env.js", () => ({
  getClaudeDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude"),
  getClaudeSettingsFile: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "settings.json"),
  getClaudeAgentsDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "agents"),
  getClaudeCommandsDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "commands"),
  getClaudeMdFile: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "CLAUDE.md"),
  getClaudeSkillsDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "skills"),
  getClaudeProfilesDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

describe("listProfiles", () => {
  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(path.join(tmpdir(), "profiles-test-"));
    testClaudeDir = path.join(testInstallDir, ".claude");
    await fs.mkdir(testClaudeDir, { recursive: true });
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  it("should list all installed profiles", async () => {
    const profilesDir = path.join(testClaudeDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    // Create user-facing profiles
    for (const name of ["amol", "senior-swe"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
      await fs.writeFile(
        path.join(dir, "profile.json"),
        JSON.stringify({ extends: "_base", name, description: "Test" }),
      );
    }

    const { listProfiles } = await import("./profiles.js");
    const profiles = await listProfiles({ installDir: testInstallDir });

    expect(profiles).toEqual(["amol", "senior-swe"]);
  });
});

describe("switchProfile", () => {
  beforeEach(async () => {
    testInstallDir = await fs.mkdtemp(path.join(tmpdir(), "switch-test-"));
    testClaudeDir = path.join(testInstallDir, ".claude");
    await fs.mkdir(testClaudeDir, { recursive: true });
  });

  afterEach(async () => {
    if (testInstallDir) {
      await fs.rm(testInstallDir, { recursive: true, force: true });
    }
  });

  it("should preserve registryAuths when switching profiles", async () => {
    // Create profiles directory with test profiles
    const profilesDir = path.join(testClaudeDir, "profiles");
    await fs.mkdir(profilesDir, { recursive: true });

    for (const name of ["profile-a", "profile-b"]) {
      const dir = path.join(profilesDir, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "CLAUDE.md"), `# ${name}`);
    }

    // Create initial config with registryAuths
    const configPath = path.join(testInstallDir, ".nori-config.json");
    const initialConfig = {
      profile: { baseProfile: "profile-a" },
      registryAuths: [
        {
          username: "test@example.com",
          password: "secret123",
          registryUrl: "https://private.registry.com",
        },
      ],
      sendSessionTranscript: "enabled",
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));

    // Switch to profile-b
    const { switchProfile } = await import("./profiles.js");
    await switchProfile({
      profileName: "profile-b",
      installDir: testInstallDir,
    });

    // Verify registryAuths was preserved
    const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(updatedConfig.profile.baseProfile).toBe("profile-b");
    expect(updatedConfig.registryAuths).toEqual([
      {
        username: "test@example.com",
        password: "secret123",
        registryUrl: "https://private.registry.com",
      },
    ]);
  });
});
