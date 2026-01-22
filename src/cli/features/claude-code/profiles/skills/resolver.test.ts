/**
 * Tests for skill resolution functionality
 * Handles parsing skills.json and resolving skill versions
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  readSkillsJson,
  parseSkillsJson,
  resolveSkillVersion,
  writeSkillsJson,
  addSkillDependency,
  type SkillsJson,
} from "./resolver.js";

describe("skills.json parsing", () => {
  describe("parseSkillsJson", () => {
    it("should parse simple version string format", () => {
      const input: SkillsJson = {
        "writing-plans": "^1.0.0",
        "test-driven-development": "2.0.0",
      };

      const result = parseSkillsJson({ skillsJson: input });

      expect(result).toEqual([
        { name: "writing-plans", versionRange: "^1.0.0" },
        { name: "test-driven-development", versionRange: "2.0.0" },
      ]);
    });

    it("should parse object format with version field", () => {
      const input: SkillsJson = {
        "writing-plans": { version: "^1.0.0" },
        "systematic-debugging": { version: "1.2.3" },
      };

      const result = parseSkillsJson({ skillsJson: input });

      expect(result).toEqual([
        { name: "writing-plans", versionRange: "^1.0.0" },
        { name: "systematic-debugging", versionRange: "1.2.3" },
      ]);
    });

    it("should handle mixed formats", () => {
      const input: SkillsJson = {
        "writing-plans": "^1.0.0",
        "systematic-debugging": { version: "2.0.0" },
      };

      const result = parseSkillsJson({ skillsJson: input });

      expect(result).toEqual([
        { name: "writing-plans", versionRange: "^1.0.0" },
        { name: "systematic-debugging", versionRange: "2.0.0" },
      ]);
    });

    it("should handle wildcard version", () => {
      const input: SkillsJson = {
        "writing-plans": "*",
      };

      const result = parseSkillsJson({ skillsJson: input });

      expect(result).toEqual([{ name: "writing-plans", versionRange: "*" }]);
    });

    it("should return empty array for empty skills.json", () => {
      const input: SkillsJson = {};

      const result = parseSkillsJson({ skillsJson: input });

      expect(result).toEqual([]);
    });
  });

  describe("readSkillsJson", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should read and parse skills.json from profile directory", async () => {
      const skillsJson = {
        "writing-plans": "^1.0.0",
        "test-driven-development": "2.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, "skills.json"),
        JSON.stringify(skillsJson),
      );

      const result = await readSkillsJson({ profileDir: tempDir });

      expect(result).toEqual([
        { name: "writing-plans", versionRange: "^1.0.0" },
        { name: "test-driven-development", versionRange: "2.0.0" },
      ]);
    });

    it("should return null when skills.json does not exist", async () => {
      const result = await readSkillsJson({ profileDir: tempDir });

      expect(result).toBeNull();
    });

    it("should throw error on invalid JSON", async () => {
      await fs.writeFile(path.join(tempDir, "skills.json"), "invalid json");

      await expect(readSkillsJson({ profileDir: tempDir })).rejects.toThrow();
    });
  });
});

describe("skills.json writing", () => {
  describe("writeSkillsJson", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-write-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should write skills.json with given dependencies", async () => {
      const dependencies = [
        { name: "writing-plans", versionRange: "^1.0.0" },
        { name: "test-driven-development", versionRange: "*" },
      ];

      await writeSkillsJson({ profileDir: tempDir, dependencies });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({
        "writing-plans": "^1.0.0",
        "test-driven-development": "*",
      });
    });

    it("should write with proper JSON formatting (2-space indent)", async () => {
      const dependencies = [{ name: "my-skill", versionRange: "*" }];

      await writeSkillsJson({ profileDir: tempDir, dependencies });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );

      // Check formatting - should have 2-space indentation
      expect(content).toContain('{\n  "my-skill"');
    });

    it("should write empty object for empty dependencies", async () => {
      await writeSkillsJson({ profileDir: tempDir, dependencies: [] });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({});
    });

    it("should overwrite existing skills.json", async () => {
      // Write initial file
      await fs.writeFile(
        path.join(tempDir, "skills.json"),
        JSON.stringify({ "old-skill": "1.0.0" }),
      );

      // Overwrite with new dependencies
      const dependencies = [{ name: "new-skill", versionRange: "*" }];
      await writeSkillsJson({ profileDir: tempDir, dependencies });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({ "new-skill": "*" });
      expect(parsed).not.toHaveProperty("old-skill");
    });
  });

  describe("addSkillDependency", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-add-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should create skills.json when it does not exist", async () => {
      await addSkillDependency({
        profileDir: tempDir,
        skillName: "new-skill",
        version: "*",
      });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({ "new-skill": "*" });
    });

    it("should add skill to existing skills.json", async () => {
      // Create initial skills.json
      await fs.writeFile(
        path.join(tempDir, "skills.json"),
        JSON.stringify({ "existing-skill": "^1.0.0" }),
      );

      await addSkillDependency({
        profileDir: tempDir,
        skillName: "new-skill",
        version: "*",
      });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({
        "existing-skill": "^1.0.0",
        "new-skill": "*",
      });
    });

    it("should update version when skill already exists", async () => {
      // Create initial skills.json with the skill
      await fs.writeFile(
        path.join(tempDir, "skills.json"),
        JSON.stringify({ "my-skill": "1.0.0" }),
      );

      await addSkillDependency({
        profileDir: tempDir,
        skillName: "my-skill",
        version: "*",
      });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({ "my-skill": "*" });
    });

    it("should preserve other entries when adding new skill", async () => {
      // Create skills.json with multiple skills
      await fs.writeFile(
        path.join(tempDir, "skills.json"),
        JSON.stringify({
          "skill-a": "^1.0.0",
          "skill-b": "2.0.0",
          "skill-c": "*",
        }),
      );

      await addSkillDependency({
        profileDir: tempDir,
        skillName: "skill-d",
        version: "*",
      });

      const content = await fs.readFile(
        path.join(tempDir, "skills.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({
        "skill-a": "^1.0.0",
        "skill-b": "2.0.0",
        "skill-c": "*",
        "skill-d": "*",
      });
    });
  });
});

describe("skill version resolution", () => {
  describe("resolveSkillVersion", () => {
    it("should return exact version when available", () => {
      const availableVersions = ["1.0.0", "1.1.0", "2.0.0"];

      const result = resolveSkillVersion({
        versionRange: "1.1.0",
        availableVersions,
      });

      expect(result).toBe("1.1.0");
    });

    it("should resolve caret range to highest matching version", () => {
      const availableVersions = ["1.0.0", "1.1.0", "1.2.0", "2.0.0"];

      const result = resolveSkillVersion({
        versionRange: "^1.0.0",
        availableVersions,
      });

      expect(result).toBe("1.2.0");
    });

    it("should resolve tilde range to highest matching version", () => {
      const availableVersions = ["1.0.0", "1.0.1", "1.0.2", "1.1.0"];

      const result = resolveSkillVersion({
        versionRange: "~1.0.0",
        availableVersions,
      });

      expect(result).toBe("1.0.2");
    });

    it("should resolve wildcard to latest version", () => {
      const availableVersions = ["1.0.0", "1.1.0", "2.0.0"];

      const result = resolveSkillVersion({
        versionRange: "*",
        availableVersions,
      });

      expect(result).toBe("2.0.0");
    });

    it("should return null when no version matches", () => {
      const availableVersions = ["1.0.0", "1.1.0"];

      const result = resolveSkillVersion({
        versionRange: "^2.0.0",
        availableVersions,
      });

      expect(result).toBeNull();
    });

    it("should return null for empty available versions", () => {
      const result = resolveSkillVersion({
        versionRange: "^1.0.0",
        availableVersions: [],
      });

      expect(result).toBeNull();
    });
  });
});
