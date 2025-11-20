/**
 * Tests for path utility functions
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { normalizeInstallDir, findAncestorInstallations } from "./path.js";

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

describe("findAncestorInstallations", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nori-test-"));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detection of nori installations", () => {
    it("should return empty array when no ancestor installations exist", () => {
      // Create nested directories without any nori installations
      const childDir = path.join(tempDir, "parent", "child", "grandchild");
      fs.mkdirSync(childDir, { recursive: true });

      const result = findAncestorInstallations({
        installDir: path.join(childDir, ".claude"),
      });

      expect(result).toEqual([]);
    });

    it("should detect .nori-config.json in parent directory", () => {
      // Create structure: tempDir/parent/.nori-config.json, tempDir/parent/child/
      const parentDir = path.join(tempDir, "parent");
      const childDir = path.join(parentDir, "child");
      fs.mkdirSync(childDir, { recursive: true });

      // Create .nori-config.json in parent
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const result = findAncestorInstallations({
        installDir: path.join(childDir, ".claude"),
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should detect nori-config.json (legacy) in parent directory", () => {
      // Create structure with legacy config file
      const parentDir = path.join(tempDir, "parent");
      const childDir = path.join(parentDir, "child");
      fs.mkdirSync(childDir, { recursive: true });

      // Create legacy nori-config.json in parent
      fs.writeFileSync(
        path.join(parentDir, "nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const result = findAncestorInstallations({
        installDir: path.join(childDir, ".claude"),
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should detect CLAUDE.md with NORI-AI MANAGED BLOCK in parent directory", () => {
      // Create structure with CLAUDE.md containing managed block
      const parentDir = path.join(tempDir, "parent");
      const childDir = path.join(parentDir, "child");
      const parentClaudeDir = path.join(parentDir, ".claude");
      fs.mkdirSync(childDir, { recursive: true });
      fs.mkdirSync(parentClaudeDir, { recursive: true });

      // Create CLAUDE.md with managed block marker
      fs.writeFileSync(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# Some content\n# BEGIN NORI-AI MANAGED BLOCK\nsome config\n# END NORI-AI MANAGED BLOCK\n",
      );

      const result = findAncestorInstallations({
        installDir: path.join(childDir, ".claude"),
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should NOT detect CLAUDE.md without NORI-AI MANAGED BLOCK", () => {
      // Create structure with CLAUDE.md but without managed block
      const parentDir = path.join(tempDir, "parent");
      const childDir = path.join(parentDir, "child");
      const parentClaudeDir = path.join(parentDir, ".claude");
      fs.mkdirSync(childDir, { recursive: true });
      fs.mkdirSync(parentClaudeDir, { recursive: true });

      // Create CLAUDE.md without managed block
      fs.writeFileSync(
        path.join(parentClaudeDir, "CLAUDE.md"),
        "# Some content\nNot a nori installation\n",
      );

      const result = findAncestorInstallations({
        installDir: path.join(childDir, ".claude"),
      });

      expect(result).toEqual([]);
    });

    it("should detect multiple ancestor installations", () => {
      // Create structure: tempDir/grandparent/parent/child
      const grandparentDir = path.join(tempDir, "grandparent");
      const parentDir = path.join(grandparentDir, "parent");
      const childDir = path.join(parentDir, "child");
      fs.mkdirSync(childDir, { recursive: true });

      // Create nori config in both grandparent and parent
      fs.writeFileSync(
        path.join(grandparentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "grandparent" } }),
      );
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      const result = findAncestorInstallations({
        installDir: path.join(childDir, ".claude"),
      });

      // Should find both, ordered from closest to furthest
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(parentDir);
      expect(result[1]).toBe(grandparentDir);
    });
  });

  describe("edge cases", () => {
    it("should stop at filesystem root", () => {
      // Use a path close to root to verify we don't infinite loop
      const result = findAncestorInstallations({
        installDir: "/tmp/test-nori/.claude",
      });

      // Should return empty (no installations) without errors
      expect(result).toEqual([]);
    });

    it("should handle installDir that already ends with .claude", () => {
      const parentDir = path.join(tempDir, "parent");
      const childDir = path.join(parentDir, "child");
      fs.mkdirSync(childDir, { recursive: true });

      // Create nori config in parent
      fs.writeFileSync(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const result = findAncestorInstallations({
        installDir: path.join(childDir, ".claude"),
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(parentDir);
    });

    it("should not include the current installation directory in results", () => {
      // If we're checking /foo/bar/.claude, we should not include /foo/bar in results
      const installParentDir = path.join(tempDir, "project");
      fs.mkdirSync(installParentDir, { recursive: true });

      // Create nori config in the same directory we're installing to
      fs.writeFileSync(
        path.join(installParentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "test" } }),
      );

      const result = findAncestorInstallations({
        installDir: path.join(installParentDir, ".claude"),
      });

      // Should NOT find the installation at the same level
      expect(result).toEqual([]);
    });
  });
});
