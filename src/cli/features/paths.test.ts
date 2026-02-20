/**
 * Tests for shared path helper functions
 * These paths are agent-agnostic and used across all agents
 */

import * as os from "os";
import * as path from "path";

import { describe, it, expect } from "vitest";

import { getNoriDir, getNoriSkillsetsDir } from "./paths.js";

describe("Shared Nori paths", () => {
  describe("getNoriDir", () => {
    it("should return ~/.nori", () => {
      const result = getNoriDir();
      expect(result).toBe(path.join(os.homedir(), ".nori"));
    });
  });

  describe("getNoriSkillsetsDir", () => {
    it("should return ~/.nori/profiles", () => {
      const result = getNoriSkillsetsDir();
      expect(result).toBe(path.join(os.homedir(), ".nori", "profiles"));
    });
  });
});
