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
    it("should return process.cwd() when no installDir provided", () => {
      const result = normalizeInstallDir({});
      expect(result).toBe(process.cwd());
    });

    it("should return process.cwd() when installDir is null", () => {
      const result = normalizeInstallDir({ installDir: null });
      expect(result).toBe(process.cwd());
    });

    it("should return process.cwd() when installDir is undefined", () => {
      const result = normalizeInstallDir({ installDir: undefined });
      expect(result).toBe(process.cwd());
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
    it("should handle empty string by using cwd", () => {
      const result = normalizeInstallDir({ installDir: "" });
      expect(result).toBe(process.cwd());
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
