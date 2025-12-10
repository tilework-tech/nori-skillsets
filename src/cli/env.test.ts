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
  getCursorDir,
  getCursorSettingsFile,
  getCursorProfilesDir,
  getCursorHomeDir,
  getCursorHomeSettingsFile,
  getCursorHooksFile,
  getCursorHomeHooksFile,
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

// Cursor environment path tests

describe("getCursorDir", () => {
  it("should return process.cwd()/.cursor when installDir is cwd", () => {
    const result = getCursorDir({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".cursor"));
  });

  it("should return custom installDir/.cursor when installDir provided", () => {
    const result = getCursorDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.cursor");
  });

  it("should preserve tilde in installDir (no expansion)", () => {
    const result = getCursorDir({ installDir: "~/project" });
    expect(result).toBe("~/project/.cursor");
  });
});

describe("getCursorSettingsFile", () => {
  it("should return settings.json in default cursor dir", () => {
    const result = getCursorSettingsFile({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".cursor", "settings.json"));
  });

  it("should return settings.json in custom cursor dir", () => {
    const result = getCursorSettingsFile({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.cursor/settings.json");
  });
});

describe("getCursorProfilesDir", () => {
  it("should return profiles dir in default cursor dir", () => {
    const result = getCursorProfilesDir({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".cursor", "profiles"));
  });

  it("should return profiles dir in custom cursor dir", () => {
    const result = getCursorProfilesDir({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.cursor/profiles");
  });
});

describe("getCursorHomeDir", () => {
  it("should return ~/.cursor expanded to absolute path", () => {
    const result = getCursorHomeDir();
    const expected = path.join(
      process.env.HOME || process.env.USERPROFILE || "~",
      ".cursor",
    );
    expect(result).toBe(expected);
  });

  it("should not depend on any installDir parameter", () => {
    const result = getCursorHomeDir();
    // Should always return home directory, not vary based on installDir
    expect(result).toContain(".cursor");
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe("getCursorHomeSettingsFile", () => {
  it("should return ~/.cursor/settings.json", () => {
    const result = getCursorHomeSettingsFile();
    const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
    const expected = path.join(homeDir, ".cursor", "settings.json");
    expect(result).toBe(expected);
  });

  it("should not depend on any installDir parameter", () => {
    const result = getCursorHomeSettingsFile();
    expect(result).toContain(".cursor");
    expect(result).toContain("settings.json");
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe("getCursorHooksFile", () => {
  it("should return {installDir}/.cursor/hooks.json for cwd", () => {
    const result = getCursorHooksFile({ installDir: process.cwd() });
    expect(result).toBe(path.join(process.cwd(), ".cursor", "hooks.json"));
  });

  it("should return {installDir}/.cursor/hooks.json for custom path", () => {
    const result = getCursorHooksFile({ installDir: "/custom/path" });
    expect(result).toBe("/custom/path/.cursor/hooks.json");
  });
});

describe("getCursorHomeHooksFile", () => {
  it("should return ~/.cursor/hooks.json", () => {
    const result = getCursorHomeHooksFile();
    const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
    const expected = path.join(homeDir, ".cursor", "hooks.json");
    expect(result).toBe(expected);
  });

  it("should not depend on any installDir parameter", () => {
    const result = getCursorHomeHooksFile();
    expect(result).toContain(".cursor");
    expect(result).toContain("hooks.json");
    expect(path.isAbsolute(result)).toBe(true);
  });
});
