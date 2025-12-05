import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the directories before importing
// testBaseDir is the install root, testClaudeDir is inside it
let testBaseDir: string;
let testClaudeDir: string;
let testNoriDir: string;

vi.mock("@/installer/env.js", () => ({
  getClaudeDir: () => testClaudeDir,
  getClaudeSettingsFile: () => path.join(testClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(testClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(testClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(testClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(testClaudeDir, "skills"),
  getNoriDir: () => testNoriDir,
  getNoriProfilesDir: () => path.join(testNoriDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

describe("listProfiles", () => {
  beforeEach(async () => {
    testBaseDir = await fs.mkdtemp(path.join(tmpdir(), "profiles-test-"));
    testClaudeDir = path.join(testBaseDir, ".claude");
    testNoriDir = path.join(testBaseDir, ".nori");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testNoriDir, { recursive: true });
  });

  afterEach(async () => {
    if (testBaseDir) {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    }
  });

  it("should list all installed profiles", async () => {
    const profilesDir = path.join(testNoriDir, "profiles");
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
    const profiles = await listProfiles({ installDir: testBaseDir });

    expect(profiles).toEqual(["amol", "senior-swe"]);
  });
});
