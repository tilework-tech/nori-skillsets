/**
 * Tests for nori-install-location intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { HookInput } from "./types.js";

import { noriInstallLocation } from "./nori-install-location.js";

/**
 * Strip ANSI escape codes from a string for plain text comparison
 *
 * @param str - The string containing ANSI codes
 *
 * @returns The string with ANSI codes removed
 */
const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
};

describe("nori-install-location", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-install-location-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");

    // Create config file to mark as Nori installation
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profile: {
          baseProfile: "senior-swe",
        },
      }),
    );
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  const createInput = (args: {
    prompt: string;
    cwd?: string | null;
  }): HookInput => {
    const { prompt, cwd } = args;
    return {
      prompt,
      cwd: cwd ?? testDir,
      hook_event_name: "beforeSubmitPrompt",
    };
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriInstallLocation.matchers).toBeInstanceOf(Array);
      expect(noriInstallLocation.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriInstallLocation.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });
  });

  describe("run function", () => {
    it("should return block decision with installation location", async () => {
      const input = createInput({ prompt: "/nori-install-location" });
      const result = await noriInstallLocation.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain(testDir);
    });
  });

  describe("behavior", () => {
    it("should return installation directory", async () => {
      const input = createInput({ prompt: "/nori-install-location" });
      const result = await noriInstallLocation.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      const plainReason = stripAnsi(result!.reason!);
      expect(plainReason).toContain(testDir);
      expect(plainReason).toContain("Nori installation");
    });

    it("should find installation from subdirectory", async () => {
      // Create subdirectory
      const subDir = path.join(testDir, "subdir", "nested");
      await fs.mkdir(subDir, { recursive: true });

      const input = createInput({
        prompt: "/nori-install-location",
        cwd: subDir,
      });
      const result = await noriInstallLocation.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain(testDir);
    });

    it("should list multiple installations when they exist", async () => {
      // Create parent installation
      const parentDir = await fs.mkdtemp(path.join(tmpdir(), "nori-parent-"));
      await fs.writeFile(
        path.join(parentDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "parent" } }),
      );

      // Create child installation
      const childDir = path.join(parentDir, "project");
      await fs.mkdir(childDir, { recursive: true });
      await fs.writeFile(
        path.join(childDir, ".nori-config.json"),
        JSON.stringify({ profile: { baseProfile: "child" } }),
      );

      try {
        const input = createInput({
          prompt: "/nori-install-location",
          cwd: childDir,
        });
        const result = await noriInstallLocation.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        // Should list both installations
        expect(result!.reason).toContain(childDir);
        expect(result!.reason).toContain(parentDir);
      } finally {
        await fs.rm(parentDir, { recursive: true, force: true });
      }
    });
  });

  describe("error handling", () => {
    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-install-location",
          cwd: noInstallDir,
        });
        const result = await noriInstallLocation.run({ input });

        expect(result).not.toBeNull();
        expect(result!.decision).toBe("block");
        expect(stripAnsi(result!.reason!)).toContain(
          "No Nori installation found",
        );
      } finally {
        await fs.rm(noInstallDir, { recursive: true, force: true });
      }
    });
  });
});
