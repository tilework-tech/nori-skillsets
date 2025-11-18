/**
 * Tests for path utility functions
 */

import * as os from "os";
import * as path from "path";

import { describe, it, expect } from "vitest";

import { normalizeInstallDir } from "./path.js";

describe("normalizeInstallDir", () => {
  describe("default behavior", () => {
    it("should return process.cwd()/.claude when no installDir provided", () => {
      const result = normalizeInstallDir({});
      expect(result).toBe(path.join(process.cwd(), ".claude"));
    });

    it("should return process.cwd()/.claude when installDir is null", () => {
      const result = normalizeInstallDir({ installDir: null });
      expect(result).toBe(path.join(process.cwd(), ".claude"));
    });

    it("should return process.cwd()/.claude when installDir is undefined", () => {
      const result = normalizeInstallDir({ installDir: undefined });
      expect(result).toBe(path.join(process.cwd(), ".claude"));
    });
  });

  describe("custom installDir", () => {
    it("should return the provided absolute path with .claude appended", () => {
      const result = normalizeInstallDir({ installDir: "/custom/path" });
      expect(result).toBe("/custom/path/.claude");
    });

    it("should expand tilde to home directory", () => {
      const result = normalizeInstallDir({ installDir: "~/my-project" });
      expect(result).toBe(path.join(os.homedir(), "my-project", ".claude"));
    });

    it("should resolve relative paths to absolute paths", () => {
      const result = normalizeInstallDir({ installDir: "./my-project" });
      expect(result).toBe(path.join(process.cwd(), "my-project", ".claude"));
    });

    it("should handle paths with trailing slashes", () => {
      const result = normalizeInstallDir({ installDir: "/custom/path/" });
      expect(result).toBe("/custom/path/.claude");
    });

    it("should handle paths ending with .claude already", () => {
      const result = normalizeInstallDir({
        installDir: "/custom/path/.claude",
      });
      expect(result).toBe("/custom/path/.claude");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string by using cwd", () => {
      const result = normalizeInstallDir({ installDir: "" });
      expect(result).toBe(path.join(process.cwd(), ".claude"));
    });

    it("should handle paths with spaces", () => {
      const result = normalizeInstallDir({
        installDir: "/path/with spaces/project",
      });
      expect(result).toBe("/path/with spaces/project/.claude");
    });

    it("should normalize multiple slashes", () => {
      const result = normalizeInstallDir({
        installDir: "/custom//path///project",
      });
      expect(result).toBe("/custom/path/project/.claude");
    });
  });
});
