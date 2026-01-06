/**
 * Tests for scripts/prepublish.sh
 *
 * These tests verify the interactive prepublish script that:
 * 1. Prompts user whether to update release notes
 * 2. Runs headless Claude to generate release notes if yes
 * 3. Prompts user whether to stage and commit changes
 * 4. Aborts publish if user declines to commit
 */

import * as fs from "fs";
import * as path from "path";

import { describe, it, expect } from "vitest";

describe("scripts/prepublish.sh", () => {
  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, "scripts", "prepublish.sh");

  describe("file structure", () => {
    it("should exist in scripts directory", () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it("should be executable", () => {
      fs.accessSync(scriptPath, fs.constants.X_OK);
    });

    it("should have bash shebang", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      expect(content.startsWith("#!/bin/bash")).toBe(true);
    });
  });

  describe("interactive prompts", () => {
    it("should prompt user about updating release notes", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      // Should use read command for prompting (portable form: -r without -p)
      expect(content).toMatch(/read\s+-r\b/);
      // Should mention release notes in the prompt
      expect(content.toLowerCase()).toMatch(/release\s*notes/);
    });

    it("should prompt user about staging and committing", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      // Should have at least two read prompts (one for release notes, one for commit)
      const readMatches = content.match(/read\s+-r\b/g);
      expect(readMatches).not.toBeNull();
      expect(readMatches!.length).toBeGreaterThanOrEqual(2);
      // Should mention commit or stage
      expect(content.toLowerCase()).toMatch(/commit|stage/);
    });
  });

  describe("claude invocation", () => {
    it("should invoke claude in headless mode with -p flag", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      expect(content).toMatch(/claude\s+-p/);
    });

    it("should reference release-notes-update.md", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      expect(content).toMatch(/release-notes-update\.md/);
    });

    it("should specify --allowedTools", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      expect(content).toMatch(/--allowedTools/);
    });
  });

  describe("git operations", () => {
    it("should perform git add for release notes", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      expect(content).toMatch(/git\s+add/);
    });

    it("should perform git commit", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      expect(content).toMatch(/git\s+commit/);
    });
  });

  describe("exit behavior", () => {
    it("should exit with non-zero when user declines to commit", () => {
      const content = fs.readFileSync(scriptPath, "utf-8");
      // Should have exit 1 somewhere for the abort path
      expect(content).toMatch(/exit\s+1/);
    });
  });
});

describe("package.json prepublishOnly", () => {
  const projectRoot = process.cwd();
  const packageJsonPath = path.join(projectRoot, "package.json");

  it("should reference scripts/prepublish.sh", () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    expect(packageJson.scripts.prepublishOnly).toBe("./scripts/prepublish.sh");
  });
});
