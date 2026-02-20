/**
 * Tests for path utility functions
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { normalizeInstallDir, getInstallDirs } from "./path.js";

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

  describe("detects managed CLAUDE.md blocks", () => {
    it("should return directory when it has a managed CLAUDE.md block", () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nsome content\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(projectDir);
    });

    it("should return current directory first, then ancestors when both have managed blocks", () => {
      const parentDir = path.join(tempDir, "parent");
      const projectDir = path.join(parentDir, "project");
      const parentClaudeDir = path.join(parentDir, ".claude");
      const projectClaudeDir = path.join(projectDir, ".claude");
      fs.mkdirSync(parentClaudeDir, { recursive: true });
      fs.mkdirSync(projectClaudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nparent\n# END NORI-AI MANAGED BLOCK",
      );
      fs.writeFileSync(
        path.join(projectClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nproject\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(projectDir);
      expect(result[1]).toBe(parentDir);
    });
  });

  describe("does not detect .nori-config.json", () => {
    it("should not detect directory with only .nori-config.json", () => {
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      fs.writeFileSync(
        path.join(projectDir, ".nori-config.json"),
        JSON.stringify({ activeSkillset: "test" }),
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toEqual([]);
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
      const parentClaudeDir = path.join(parentDir, ".claude");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(parentClaudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nparent\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should return all ancestor installations in order (closest first)", () => {
      const grandparentDir = path.join(tempDir, "grandparent");
      const parentDir = path.join(grandparentDir, "parent");
      const projectDir = path.join(parentDir, "project");
      const gpClaudeDir = path.join(grandparentDir, ".claude");
      const parentClaudeDir = path.join(parentDir, ".claude");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(gpClaudeDir, { recursive: true });
      fs.mkdirSync(parentClaudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(gpClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ngp\n# END NORI-AI MANAGED BLOCK",
      );
      fs.writeFileSync(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\nparent\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(parentDir);
      expect(result[1]).toBe(grandparentDir);
    });
  });

  describe("CLAUDE.md without managed block", () => {
    it("should not detect directory if CLAUDE.md lacks managed block", () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# Some other content\nNo managed block here",
      );

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toEqual([]);
    });
  });

  describe("default currentDir behavior", () => {
    it("should use process.cwd() when currentDir not provided", () => {
      const result = getInstallDirs({});
      expect(Array.isArray(result)).toBe(true);
    });

    it("should use process.cwd() when currentDir is null", () => {
      const result = getInstallDirs({ currentDir: null });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe(".nori-managed marker detection", () => {
    it("should detect directory with .claude/.nori-managed as installation", () => {
      const projectDir = path.join(tempDir, "project");
      const claudeDir = path.join(projectDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, ".nori-managed"), "senior-swe");

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(projectDir);
    });

    it("should detect ancestor with .claude/.nori-managed marker", () => {
      const parentDir = path.join(tempDir, "parent");
      const projectDir = path.join(parentDir, "project");
      const claudeDir = path.join(parentDir, ".claude");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, ".nori-managed"), "my-profile");

      const result = getInstallDirs({ currentDir: projectDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });
  });

  describe("cwd inside .claude directory", () => {
    it("should find installation in parent when cwd is inside .claude directory", () => {
      const parentDir = path.join(tempDir, "home");
      const claudeDir = path.join(parentDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirs({ currentDir: claudeDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should find installation when cwd is inside .claude/profiles subdirectory", () => {
      const parentDir = path.join(tempDir, "home");
      const claudeDir = path.join(parentDir, ".claude");
      const skillsetsDir = path.join(claudeDir, "profiles");
      fs.mkdirSync(skillsetsDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirs({ currentDir: skillsetsDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should find installation when cwd is deeply nested inside .claude directory", () => {
      const parentDir = path.join(tempDir, "home");
      const claudeDir = path.join(parentDir, ".claude");
      const deepDir = path.join(claudeDir, "profiles", "senior-swe");
      fs.mkdirSync(deepDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, "CLAUDE.md"),
        "# BEGIN NORI-AI MANAGED BLOCK\ncontent\n# END NORI-AI MANAGED BLOCK",
      );

      const result = getInstallDirs({ currentDir: deepDir });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });
  });
});
