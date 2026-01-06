/**
 * Tests for release notes prepublish feature
 *
 * These tests verify that:
 * 1. The release-notes-update.md file exists with proper structure
 * 2. The release-notes.txt file exists
 * 3. The package.json has the correct prepublishOnly script
 */

import * as fs from "fs";
import * as path from "path";

import { describe, it, expect } from "vitest";

describe("release notes prepublish feature", () => {
  const projectRoot = process.cwd();

  describe("release-notes-update.md", () => {
    const releaseNotesUpdatePath = path.join(
      projectRoot,
      "release-notes-update.md",
    );

    it("should exist in project root", () => {
      expect(fs.existsSync(releaseNotesUpdatePath)).toBe(true);
    });

    it("should have valid YAML frontmatter with name and description", () => {
      const content = fs.readFileSync(releaseNotesUpdatePath, "utf-8");

      // Check for frontmatter delimiters
      expect(content).toMatch(/^---\n/);
      expect(content).toMatch(/\n---\n/);

      // Extract frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();

      const frontmatter = frontmatterMatch![1];

      // Check for required fields
      expect(frontmatter).toMatch(/name:/);
      expect(frontmatter).toMatch(/description:/);
    });

    it("should have a <required> block with step-by-step instructions", () => {
      const content = fs.readFileSync(releaseNotesUpdatePath, "utf-8");

      // Check for required block
      expect(content).toMatch(/<required>/);
      expect(content).toMatch(/<\/required>/);

      // Extract required block
      const requiredMatch = content.match(/<required>([\s\S]*?)<\/required>/);
      expect(requiredMatch).not.toBeNull();

      const requiredContent = requiredMatch![1];

      // Should contain numbered steps or bullet points
      expect(requiredContent).toMatch(/\d+\.|[-*]/);
    });

    it("should contain instructions for finding the last version commit", () => {
      const content = fs.readFileSync(releaseNotesUpdatePath, "utf-8");

      // Should mention git log for finding version commits
      expect(content).toMatch(/git\s+log/i);
    });

    it("should contain instructions for updating release-notes.txt", () => {
      const content = fs.readFileSync(releaseNotesUpdatePath, "utf-8");

      // Should reference the release notes file
      expect(content).toMatch(/release-notes\.txt/i);
    });
  });

  describe("release-notes.txt", () => {
    const releaseNotesPath = path.join(projectRoot, "release-notes.txt");

    it("should exist in project root", () => {
      expect(fs.existsSync(releaseNotesPath)).toBe(true);
    });
  });

  describe("package.json prepublishOnly script", () => {
    const packageJsonPath = path.join(projectRoot, "package.json");

    it("should have a prepublishOnly script", () => {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      expect(packageJson.scripts).toBeDefined();
      expect(packageJson.scripts.prepublishOnly).toBeDefined();
    });

    it("should invoke claude with -p flag for headless mode", () => {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      const prepublishScript = packageJson.scripts.prepublishOnly;

      // Should use claude with -p flag
      expect(prepublishScript).toMatch(/claude\s+-p/);
    });

    it("should reference release-notes-update.md in the prompt", () => {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      const prepublishScript = packageJson.scripts.prepublishOnly;

      // Should reference the markdown file
      expect(prepublishScript).toMatch(/release-notes-update\.md/);
    });

    it("should specify --allowedTools for necessary operations", () => {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      const prepublishScript = packageJson.scripts.prepublishOnly;

      // Should have allowedTools flag
      expect(prepublishScript).toMatch(/--allowedTools/);

      // Should allow Read for reading files
      expect(prepublishScript).toMatch(/Read/);

      // Should allow some form of file writing (Edit or Write)
      expect(prepublishScript).toMatch(/Edit|Write/);

      // Should allow Bash for git commands
      expect(prepublishScript).toMatch(/Bash/);
    });
  });
});
