/**
 * Tests for environment path functions
 */

import * as path from "path";

import { describe, it, expect } from "vitest";

import {
  getClaudeDir,
  getClaudeSettingsFile,
  getClaudeAgentsDir,
  getClaudeCommandsDir,
  getClaudeMdFile,
  getClaudeSkillsDir,
  getClaudeProfilesDir,
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
} from "./env.js";

describe("getClaudeDir", () => {
  it("should return process.cwd()/.claude when installDir is cwd", () => {
    const result = getClaudeDir({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".claude"));
  });

  it("should return custom installDir/.claude when installDir provided", () => {
    const result = getClaudeDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude");
  });

  it("should preserve tilde in installDir (no expansion)", () => {
    const result = getClaudeDir({ installDir: "~/project" });
    expect(result).toBe("~/project/.claude");
  });
});

describe("getClaudeSettingsFile", () => {
  it("should return settings.json in default claude dir", () => {
    const result = getClaudeSettingsFile({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".claude", "settings.json"));
  });

  it("should return settings.json in custom claude dir", () => {
    const result = getClaudeSettingsFile({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/settings.json");
  });
});

describe("getClaudeAgentsDir", () => {
  it("should return agents dir in default claude dir", () => {
    const result = getClaudeAgentsDir({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".claude", "agents"));
  });

  it("should return agents dir in custom claude dir", () => {
    const result = getClaudeAgentsDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/agents");
  });
});

describe("getClaudeCommandsDir", () => {
  it("should return commands dir in default claude dir", () => {
    const result = getClaudeCommandsDir({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".claude", "commands"));
  });

  it("should return commands dir in custom claude dir", () => {
    const result = getClaudeCommandsDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/commands");
  });
});

describe("getClaudeMdFile", () => {
  it("should return CLAUDE.md in default claude dir", () => {
    const result = getClaudeMdFile({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".claude", "CLAUDE.md"));
  });

  it("should return CLAUDE.md in custom claude dir", () => {
    const result = getClaudeMdFile({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/CLAUDE.md");
  });
});

describe("getClaudeSkillsDir", () => {
  it("should return skills dir in default claude dir", () => {
    const result = getClaudeSkillsDir({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".claude", "skills"));
  });

  it("should return skills dir in custom claude dir", () => {
    const result = getClaudeSkillsDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/skills");
  });
});

describe("getClaudeProfilesDir", () => {
  it("should return profiles dir in default claude dir", () => {
    const result = getClaudeProfilesDir({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".claude", "profiles"));
  });

  it("should return profiles dir in custom claude dir", () => {
    const result = getClaudeProfilesDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/profiles");
  });
});

describe("getClaudeHomeDir", () => {
  it("should return ~/.claude expanded to absolute path", () => {
    const result = getClaudeHomeDir();
    const expected = path.join(
      process.env.HOME || process.env.USERPROFILE || "~",
      ".claude",
    );
    expect(result).toBe(expected);
  });

  it("should not depend on any installDir parameter", () => {
    const result = getClaudeHomeDir();
    // Should always return home directory, not vary based on installDir
    expect(result).toContain(".claude");
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe("getClaudeHomeSettingsFile", () => {
  it("should return ~/.claude/settings.json", () => {
    const result = getClaudeHomeSettingsFile();
    const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
    const expected = path.join(homeDir, ".claude", "settings.json");
    expect(result).toBe(expected);
  });

  it("should not depend on any installDir parameter", () => {
    const result = getClaudeHomeSettingsFile();
    expect(result).toContain(".claude");
    expect(result).toContain("settings.json");
    expect(path.isAbsolute(result)).toBe(true);
  });
});
