/**
 * Tests for Claude Code path helper functions
 */

import * as os from "os";
import * as path from "path";

import { describe, expect, test, vi, beforeEach } from "vitest";

import type * as osModule from "os";

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
  getClaudeHomeCommandsDir,
} from "./paths.js";

// Mock os.homedir for consistent test results
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof osModule>();
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

describe("Claude Code Paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Installation-dependent paths", () => {
    const standardInstallDir = "/home/user";
    const customInstallDir = "/custom/path";

    describe("getClaudeDir", () => {
      test("returns .claude subdirectory of installDir", () => {
        expect(getClaudeDir({ installDir: standardInstallDir })).toBe(
          path.join(standardInstallDir, ".claude"),
        );
      });

      test("works with custom install directory", () => {
        expect(getClaudeDir({ installDir: customInstallDir })).toBe(
          path.join(customInstallDir, ".claude"),
        );
      });
    });

    describe("getClaudeSettingsFile", () => {
      test("returns settings.json inside .claude directory", () => {
        expect(getClaudeSettingsFile({ installDir: standardInstallDir })).toBe(
          path.join(standardInstallDir, ".claude", "settings.json"),
        );
      });

      test("works with custom install directory", () => {
        expect(getClaudeSettingsFile({ installDir: customInstallDir })).toBe(
          path.join(customInstallDir, ".claude", "settings.json"),
        );
      });
    });

    describe("getClaudeAgentsDir", () => {
      test("returns agents subdirectory of .claude", () => {
        expect(getClaudeAgentsDir({ installDir: standardInstallDir })).toBe(
          path.join(standardInstallDir, ".claude", "agents"),
        );
      });

      test("works with custom install directory", () => {
        expect(getClaudeAgentsDir({ installDir: customInstallDir })).toBe(
          path.join(customInstallDir, ".claude", "agents"),
        );
      });
    });

    describe("getClaudeCommandsDir", () => {
      test("returns commands subdirectory of .claude", () => {
        expect(getClaudeCommandsDir({ installDir: standardInstallDir })).toBe(
          path.join(standardInstallDir, ".claude", "commands"),
        );
      });

      test("works with custom install directory", () => {
        expect(getClaudeCommandsDir({ installDir: customInstallDir })).toBe(
          path.join(customInstallDir, ".claude", "commands"),
        );
      });
    });

    describe("getClaudeMdFile", () => {
      test("returns CLAUDE.md inside .claude directory", () => {
        expect(getClaudeMdFile({ installDir: standardInstallDir })).toBe(
          path.join(standardInstallDir, ".claude", "CLAUDE.md"),
        );
      });

      test("works with custom install directory", () => {
        expect(getClaudeMdFile({ installDir: customInstallDir })).toBe(
          path.join(customInstallDir, ".claude", "CLAUDE.md"),
        );
      });
    });

    describe("getClaudeSkillsDir", () => {
      test("returns skills subdirectory of .claude", () => {
        expect(getClaudeSkillsDir({ installDir: standardInstallDir })).toBe(
          path.join(standardInstallDir, ".claude", "skills"),
        );
      });

      test("works with custom install directory", () => {
        expect(getClaudeSkillsDir({ installDir: customInstallDir })).toBe(
          path.join(customInstallDir, ".claude", "skills"),
        );
      });
    });

    describe("getClaudeProfilesDir", () => {
      test("returns profiles subdirectory of .claude", () => {
        expect(getClaudeProfilesDir({ installDir: standardInstallDir })).toBe(
          path.join(standardInstallDir, ".claude", "profiles"),
        );
      });

      test("works with custom install directory", () => {
        expect(getClaudeProfilesDir({ installDir: customInstallDir })).toBe(
          path.join(customInstallDir, ".claude", "profiles"),
        );
      });
    });
  });

  describe("Global paths (home-based)", () => {
    describe("getClaudeHomeDir", () => {
      test("returns .claude subdirectory of home directory", () => {
        expect(getClaudeHomeDir()).toBe(path.join("/mock/home", ".claude"));
      });

      test("uses os.homedir to get home directory", () => {
        getClaudeHomeDir();
        expect(os.homedir).toHaveBeenCalled();
      });
    });

    describe("getClaudeHomeSettingsFile", () => {
      test("returns settings.json inside home .claude directory", () => {
        expect(getClaudeHomeSettingsFile()).toBe(
          path.join("/mock/home", ".claude", "settings.json"),
        );
      });
    });

    describe("getClaudeHomeCommandsDir", () => {
      test("returns commands directory inside home .claude directory", () => {
        expect(getClaudeHomeCommandsDir()).toBe(
          path.join("/mock/home", ".claude", "commands"),
        );
      });
    });
  });
});
