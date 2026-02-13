/**
 * Tests for path utility functions
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  normalizeInstallDir,
  getInstallDirs,
  getInstallDirsWithTypes,
} from "./path.js";

describe("normalizeInstallDir", () => {
  describe("default behavior", () => {
    it("should return os.homedir() when no installDir provided", () => {
      const result = normalizeInstallDir({});
      expect(result).toBe(os.homedir());
    });

    it("should return os.homedir() when installDir is null", () => {
      const result = normalizeInstallDir({ installDir: null });
      expect(result).toBe(os.homedir());
    });

    it("should return os.homedir() when installDir is undefined", () => {
      const result = normalizeInstallDir({ installDir: undefined });
      expect(result).toBe(os.homedir());
    });
  });

  describe("custom installDir", () => {
    it("should return the provided absolute path as base directory", () => {
      const result = normalizeInstallDir({ installDir: "/custom/path" });
      expect(result).toBe("/custom/path");
    });

    it("should expand tilde to home directory", () => {
      const result = normalizeInstallDir({ installDir: "~/my-project" });
      expect(result).toBe(path.join(os.homedir(), "my-project"));
    });

    it("should resolve relative paths to absolute paths", () => {
      const result = normalizeInstallDir({ installDir: "./my-project" });
      expect(result).toBe(path.join(process.cwd(), "my-project"));
    });

    it("should handle paths with trailing slashes", () => {
      const result = normalizeInstallDir({ installDir: "/custom/path/" });
      expect(result).toBe("/custom/path");
    });

    it("should strip .claude suffix to return base directory", () => {
      const result = normalizeInstallDir({
        installDir: "/custom/path/.claude",
      });
      expect(result).toBe("/custom/path");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string by using home directory", () => {
      const result = normalizeInstallDir({ installDir: "" });
      expect(result).toBe(os.homedir());
    });

    it("should handle paths with spaces", () => {
      const result = normalizeInstallDir({
        installDir: "/path/with spaces/project",
      });
      expect(result).toBe("/path/with spaces/project");
    });

    it("should normalize multiple slashes", () => {
      const result = normalizeInstallDir({
        installDir: "/custom//path///project",
      });
      expect(result).toBe("/custom/path/project");
    });
  });
});

describe("getInstallDirs", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nori-test-"));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("current directory has installation", () => {
    it("should return array with current directory when it has installation", () => {
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Create nori installation in current directory
      fs.writeFileSync(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(projectDir);
    });

    it("should return current directory first, then ancestors when both have installations", () => {
      const parentDir = path.join(tempDir, "parent");
      const projectDir = path.join(parentDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Create installations in both parent and current
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );
      fs.writeFileSync(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "project" } }),
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(projectDir); // Current first
      expect(result[1]).toBe(parentDir); // Then ancestor
    });
  });

  describe("current directory has no installation", () => {
    it("should return empty array when no installations found anywhere", () => {
      const projectDir = path.join(tempDir, "project", "child");
      fs.mkdirSync(projectDir, { recursive: true });

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toEqual([]);
    });

    it("should return only ancestor installations when current has none", () => {
      const parentDir = path.join(tempDir, "parent");
      const projectDir = path.join(parentDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Create installation in parent only
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should return all ancestor installations in order (closest first)", () => {
      const grandparentDir = path.join(tempDir, "grandparent");
      const parentDir = path.join(grandparentDir, "parent");
      const projectDir = path.join(parentDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Create installations in ancestors
      fs.writeFileSync(
        path.join(grandparentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "grandparent" } }),
      );
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(parentDir); // Closest ancestor
      expect(result[1]).toBe(grandparentDir); // Further ancestor
    });
  });

  describe("default currentDir behavior", () => {
    it("should use process.cwd() when currentDir not provided", () => {
      // This test is environment-dependent, so we just verify it doesn't throw
      const result = getInstallDirs({});
      expect(Array.isArray(result)).toBe(true);
    });

    it("should use process.cwd() when currentDir is null", () => {
      const result = getInstallDirs({ currentDir: null });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("cwd inside .claude directory", () => {
    it("should find installation in parent when cwd is inside .claude directory", () => {
      // Setup: parent has .nori-config.json, we call from parent/.claude/
      const parentDir = path.join(tempDir, "home");
      const claudeDir = path.join(parentDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });

      // Create installation marker in parent
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      // Call from inside .claude directory
      const result = getInstallDirs({ currentDir: claudeDir });

      // Should find the parent installation
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should find installation when cwd is inside .claude/profiles subdirectory", () => {
      // Setup: parent has .nori-config.json, we call from parent/.claude/profiles/
      const parentDir = path.join(tempDir, "home");
      const profilesDir = path.join(parentDir, ".claude", "profiles");
      fs.mkdirSync(profilesDir, { recursive: true });

      // Create installation marker in parent
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      // Call from inside .claude/profiles directory
      const result = getInstallDirs({ currentDir: profilesDir });

      // Should find the parent installation
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should find installation when cwd is deeply nested inside .claude directory", () => {
      // Setup: parent has .nori-config.json, we call from parent/.claude/profiles/senior-swe/
      const parentDir = path.join(tempDir, "home");
      const deepDir = path.join(parentDir, ".claude", "profiles", "senior-swe");
      fs.mkdirSync(deepDir, { recursive: true });

      // Create installation marker in parent
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      // Call from deeply nested directory
      const result = getInstallDirs({ currentDir: deepDir });

      // Should find the parent installation
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });
  });
});

describe("getInstallDirsWithTypes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nori-types-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("source installations (config file only)", () => {
    it("should identify directory with .nori-config.json as source type", () => {
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Create only config file (no managed block)
      fs.writeFileSync(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const result = getInstallDirsWithTypes({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: projectDir,
        type: "source",
      });
    });

    it("should identify directory with legacy nori-config.json as source type", () => {
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Create only legacy config file
      fs.writeFileSync(
        path.join(projectDir, "nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const result = getInstallDirsWithTypes({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: projectDir,
        type: "source",
      });
    });
  });

  describe("managed installations (CLAUDE.md with managed block only)", () => {
    it("should identify directory with only managed CLAUDE.md as managed type", () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });

      // Create only managed CLAUDE.md (no config file)
      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nsome content\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirsWithTypes({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: projectDir,
        type: "managed",
      });
    });
  });

  describe("both installations (config file AND managed block)", () => {
    it("should identify directory with both markers as both type", () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });

      // Create both config file and managed CLAUDE.md
      fs.writeFileSync(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );
      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nsome content\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirsWithTypes({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: projectDir,
        type: "both",
      });
    });
  });

  describe("mixed installations across directory tree", () => {
    it("should correctly classify multiple installations of different types", () => {
      // Setup: grandparent (source), parent (managed), current (both)
      const grandparentDir = path.join(tempDir, "grandparent");
      const parentDir = path.join(grandparentDir, "parent");
      const currentDir = path.join(parentDir, "current");
      const parentClaudeDir = path.join(parentDir, ".claude");
      const currentClaudeDir = path.join(currentDir, ".claude");

      fs.mkdirSync(currentClaudeDir, { recursive: true });
      fs.mkdirSync(parentClaudeDir, { recursive: true });

      // Grandparent: source only
      fs.writeFileSync(
        path.join(grandparentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "grandparent" } }),
      );

      // Parent: managed only
      fs.writeFileSync(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nparent content\n# END NORI-AI MANAGED BLOCK",
      );

      // Current: both
      fs.writeFileSync(
        path.join(currentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "current" } }),
      );
      fs.writeFileSync(
        path.join(currentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncurrent content\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirsWithTypes({ currentDir });

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ path: currentDir, type: "both" });
      expect(result[1]).toEqual({ path: parentDir, type: "managed" });
      expect(result[2]).toEqual({ path: grandparentDir, type: "source" });
    });
  });

  describe("no installations", () => {
    it("should return empty array when no installations found", () => {
      const projectDir = path.join(tempDir, "empty");
      fs.mkdirSync(projectDir, { recursive: true });

      const result = getInstallDirsWithTypes({ currentDir: projectDir });

      expect(result).toEqual([]);
    });
  });

  describe("CLAUDE.md without managed block", () => {
    it("should not classify directory as managed if CLAUDE.md lacks managed block", () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });

      // Create CLAUDE.md without managed block
      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# Some other content\nNo managed block here",
      );

      const result = getInstallDirsWithTypes({ currentDir: projectDir });

      expect(result).toEqual([]);
    });
  });
});
