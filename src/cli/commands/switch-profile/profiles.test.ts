import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the CLAUDE_DIR before importing
let testClaudeDir: string;

vi.mock("@/cli/env.js", () => ({
  getClaudeDir: () => testClaudeDir,
  getClaudeSettingsFile: () => path.join(testClaudeDir, "settings.json"),
  getClaudeAgentsDir: () => path.join(testClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(testClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(testClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(testClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(testClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
}));

describe("listProfiles", () => {
  beforeEach(async () => {
    testClaudeDir = await fs.mkdtemp(path.join(tmpdir(), "profiles-test-"));
  });

  afterEach(async () => {
    if (testClaudeDir) {
      await fs.rm(testClaudeDir, { recursive: true, force: true });
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
    const profiles = await listProfiles({ installDir: testClaudeDir });

    expect(profiles).toEqual(["amol", "senior-swe"]);
  });
});
