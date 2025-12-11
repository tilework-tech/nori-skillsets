/**
 * Tests for cursor-agent path helpers
 */

import * as os from "os";
import * as path from "path";

import { describe, test, expect, vi, beforeEach } from "vitest";

import {
  getCursorDir,
  getCursorProfilesDir,
  getCursorRulesDir,
  getCursorAgentsMdFile,
  getCursorHooksFile,
  getCursorCommandsDir,
  getCursorSubagentsDir,
  getCursorHomeDir,
  getCursorHomeHooksFile,
  getCursorHomeCommandsDir,
} from "@/cli/features/cursor-agent/paths.js";

import type * as osModule from "os";

// Mock os.homedir for consistent test results
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof osModule>();
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

describe("cursor-agent paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Installation-dependent paths", () => {
    describe("getCursorDir", () => {
      test("returns .cursor directory under installDir", () => {
        const result = getCursorDir({ installDir: "/home/user" });
        expect(result).toBe("/home/user/.cursor");
      });

      test("handles trailing slash in installDir", () => {
        const result = getCursorDir({ installDir: "/home/user/" });
        expect(result).toBe("/home/user/.cursor");
      });
    });

    describe("getCursorProfilesDir", () => {
      test("returns profiles directory under .cursor", () => {
        const result = getCursorProfilesDir({ installDir: "/home/user" });
        expect(result).toBe("/home/user/.cursor/profiles");
      });
    });

    describe("getCursorRulesDir", () => {
      test("returns rules directory under .cursor", () => {
        const result = getCursorRulesDir({ installDir: "/home/user" });
        expect(result).toBe("/home/user/.cursor/rules");
      });
    });

    describe("getCursorAgentsMdFile", () => {
      test("returns AGENTS.md file path at installDir root", () => {
        const result = getCursorAgentsMdFile({ installDir: "/home/user" });
        expect(result).toBe("/home/user/AGENTS.md");
      });
    });

    describe("getCursorHooksFile", () => {
      test("returns hooks.json file path under .cursor", () => {
        const result = getCursorHooksFile({ installDir: "/home/user" });
        expect(result).toBe("/home/user/.cursor/hooks.json");
      });
    });

    describe("getCursorCommandsDir", () => {
      test("returns commands directory under .cursor", () => {
        const result = getCursorCommandsDir({ installDir: "/home/user" });
        expect(result).toBe("/home/user/.cursor/commands");
      });
    });

    describe("getCursorSubagentsDir", () => {
      test("returns subagents directory under .cursor", () => {
        const result = getCursorSubagentsDir({ installDir: "/home/user" });
        expect(result).toBe("/home/user/.cursor/subagents");
      });
    });
  });

  describe("Global paths (home-based)", () => {
    describe("getCursorHomeDir", () => {
      test("returns .cursor subdirectory of home directory", () => {
        expect(getCursorHomeDir()).toBe(path.join("/mock/home", ".cursor"));
      });

      test("uses os.homedir to get home directory", () => {
        getCursorHomeDir();
        expect(os.homedir).toHaveBeenCalled();
      });
    });

    describe("getCursorHomeHooksFile", () => {
      test("returns hooks.json inside home .cursor directory", () => {
        expect(getCursorHomeHooksFile()).toBe(
          path.join("/mock/home", ".cursor", "hooks.json"),
        );
      });
    });

    describe("getCursorHomeCommandsDir", () => {
      test("returns commands directory inside home .cursor directory", () => {
        expect(getCursorHomeCommandsDir()).toBe(
          path.join("/mock/home", ".cursor", "commands"),
        );
      });
    });
  });
});
