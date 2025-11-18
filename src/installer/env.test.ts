/**
 * Tests for environment path functions
 */

import * as os from "os";
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
} from "./env.js";

describe("getClaudeDir", () => {
  it("should return process.cwd()/.claude when no installDir provided", () => {
    const result = getClaudeDir({});
    expect(result).toBe(path.join(process.cwd(), ".claude"));
  });

  it("should return custom installDir/.claude when installDir provided", () => {
    const result = getClaudeDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude");
  });

  it("should expand tilde in installDir", () => {
    const result = getClaudeDir({ installDir: "~/project" });
    expect(result).toBe(path.join(os.homedir(), "project", ".claude"));
  });
});

describe("getClaudeSettingsFile", () => {
  it("should return settings.json in default claude dir", () => {
    const result = getClaudeSettingsFile({});
    expect(result).toBe(path.join(process.cwd(), ".claude", "settings.json"));
  });

  it("should return settings.json in custom claude dir", () => {
    const result = getClaudeSettingsFile({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/settings.json");
  });
});

describe("getClaudeAgentsDir", () => {
  it("should return agents dir in default claude dir", () => {
    const result = getClaudeAgentsDir({});
    expect(result).toBe(path.join(process.cwd(), ".claude", "agents"));
  });

  it("should return agents dir in custom claude dir", () => {
    const result = getClaudeAgentsDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/agents");
  });
});

describe("getClaudeCommandsDir", () => {
  it("should return commands dir in default claude dir", () => {
    const result = getClaudeCommandsDir({});
    expect(result).toBe(path.join(process.cwd(), ".claude", "commands"));
  });

  it("should return commands dir in custom claude dir", () => {
    const result = getClaudeCommandsDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/commands");
  });
});

describe("getClaudeMdFile", () => {
  it("should return CLAUDE.md in default claude dir", () => {
    const result = getClaudeMdFile({});
    expect(result).toBe(path.join(process.cwd(), ".claude", "CLAUDE.md"));
  });

  it("should return CLAUDE.md in custom claude dir", () => {
    const result = getClaudeMdFile({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/CLAUDE.md");
  });
});

describe("getClaudeSkillsDir", () => {
  it("should return skills dir in default claude dir", () => {
    const result = getClaudeSkillsDir({});
    expect(result).toBe(path.join(process.cwd(), ".claude", "skills"));
  });

  it("should return skills dir in custom claude dir", () => {
    const result = getClaudeSkillsDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/skills");
  });
});

describe("getClaudeProfilesDir", () => {
  it("should return profiles dir in default claude dir", () => {
    const result = getClaudeProfilesDir({});
    expect(result).toBe(path.join(process.cwd(), ".claude", "profiles"));
  });

  it("should return profiles dir in custom claude dir", () => {
    const result = getClaudeProfilesDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.claude/profiles");
  });
});
