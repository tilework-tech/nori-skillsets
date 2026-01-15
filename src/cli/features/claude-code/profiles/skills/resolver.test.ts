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
  isSkillInstalled,
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

describe("skill installation check", () => {
  describe("isSkillInstalled", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "skills-install-test-"),
      );
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should return true when skill directory exists with SKILL.md", async () => {
      const skillDir = path.join(tempDir, ".nori", "skills", "writing-plans");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: writing-plans\ndescription: test\n---\n",
      );

      const result = await isSkillInstalled({
        installDir: tempDir,
        skillName: "writing-plans",
      });

      expect(result).toBe(true);
    });

    it("should return false when skill directory does not exist", async () => {
      const result = await isSkillInstalled({
        installDir: tempDir,
        skillName: "nonexistent-skill",
      });

      expect(result).toBe(false);
    });

    it("should return false when skill directory exists but has no SKILL.md", async () => {
      const skillDir = path.join(
        tempDir,
        ".nori",
        "skills",
        "incomplete-skill",
      );
      await fs.mkdir(skillDir, { recursive: true });
      // No SKILL.md file

      const result = await isSkillInstalled({
        installDir: tempDir,
        skillName: "incomplete-skill",
      });

      expect(result).toBe(false);
    });
  });
});
