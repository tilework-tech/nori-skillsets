/**
 * Tests for session state tracking mechanism
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isFirstPrompt,
  markFirstPromptHandled,
  getSessionMarkerPath,
} from "./session-state.js";

describe("session-state", () => {
  let testCwd: string;

  beforeEach(async () => {
    testCwd = await fs.mkdtemp(path.join(tmpdir(), "session-state-test-"));
  });

  afterEach(async () => {
    if (testCwd) {
      await fs.rm(testCwd, { recursive: true, force: true });
    }

    // Clean up any marker files
    const markerPath = getSessionMarkerPath({ cwd: testCwd });
    try {
      await fs.unlink(markerPath);
    } catch {
      // Ignore errors
    }
  });

  describe("isFirstPrompt", () => {
    it("should return true when marker file does not exist", async () => {
      const result = await isFirstPrompt({ cwd: testCwd });
      expect(result).toBe(true);
    });

    it("should return false when marker file exists", async () => {
      // Mark as handled
      await markFirstPromptHandled({ cwd: testCwd });

      const result = await isFirstPrompt({ cwd: testCwd });
      expect(result).toBe(false);
    });

    it("should return false for same cwd across multiple checks", async () => {
      // First check
      const first = await isFirstPrompt({ cwd: testCwd });
      expect(first).toBe(true);

      // Mark as handled
      await markFirstPromptHandled({ cwd: testCwd });

      // Second check
      const second = await isFirstPrompt({ cwd: testCwd });
      expect(second).toBe(false);

      // Third check
      const third = await isFirstPrompt({ cwd: testCwd });
      expect(third).toBe(false);
    });

    it("should use different markers for different cwds", async () => {
      const secondCwd = await fs.mkdtemp(
        path.join(tmpdir(), "session-state-test-2-"),
      );

      try {
        // Mark first cwd as handled
        await markFirstPromptHandled({ cwd: testCwd });

        // First cwd should not be first prompt
        const firstCwdCheck = await isFirstPrompt({ cwd: testCwd });
        expect(firstCwdCheck).toBe(false);

        // Second cwd should still be first prompt
        const secondCwdCheck = await isFirstPrompt({ cwd: secondCwd });
        expect(secondCwdCheck).toBe(true);
      } finally {
        await fs.rm(secondCwd, { recursive: true, force: true });
        const secondMarker = getSessionMarkerPath({ cwd: secondCwd });
        try {
          await fs.unlink(secondMarker);
        } catch {
          // Ignore errors
        }
      }
    });
  });

  describe("markFirstPromptHandled", () => {
    it("should create marker file", async () => {
      const markerPath = getSessionMarkerPath({ cwd: testCwd });

      // Marker should not exist initially
      await expect(fs.access(markerPath)).rejects.toThrow();

      // Mark as handled
      await markFirstPromptHandled({ cwd: testCwd });

      // Marker should now exist
      await expect(fs.access(markerPath)).resolves.not.toThrow();
    });

    it("should be idempotent", async () => {
      // Mark multiple times
      await markFirstPromptHandled({ cwd: testCwd });
      await markFirstPromptHandled({ cwd: testCwd });
      await markFirstPromptHandled({ cwd: testCwd });

      // Should still indicate not first prompt
      const result = await isFirstPrompt({ cwd: testCwd });
      expect(result).toBe(false);
    });
  });

  describe("getSessionMarkerPath", () => {
    it("should return consistent path for same cwd", () => {
      const path1 = getSessionMarkerPath({ cwd: testCwd });
      const path2 = getSessionMarkerPath({ cwd: testCwd });

      expect(path1).toBe(path2);
    });

    it("should return different paths for different cwds", async () => {
      const secondCwd = await fs.mkdtemp(
        path.join(tmpdir(), "session-state-test-2-"),
      );

      try {
        const path1 = getSessionMarkerPath({ cwd: testCwd });
        const path2 = getSessionMarkerPath({ cwd: secondCwd });

        expect(path1).not.toBe(path2);
      } finally {
        await fs.rm(secondCwd, { recursive: true, force: true });
      }
    });

    it("should use /tmp directory", () => {
      const markerPath = getSessionMarkerPath({ cwd: testCwd });
      expect(markerPath).toContain("/tmp");
      expect(markerPath).toContain("nori-cursor-session");
    });
  });
});
