/**
 * Tests for nori-toggle-session-transcripts intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { HookInput } from "./types.js";

import { noriToggleSessionTranscripts } from "./nori-toggle-session-transcripts.js";

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

describe("nori-toggle-session-transcripts", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-toggle-transcripts-test-"),
    );
    configPath = path.join(testDir, ".nori-config.json");

    // Create initial config without sendSessionTranscript field
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
      expect(noriToggleSessionTranscripts.matchers).toBeInstanceOf(Array);
      expect(noriToggleSessionTranscripts.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriToggleSessionTranscripts.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });
  });

  describe("run function", () => {
    it("should return block decision with toggle result", async () => {
      const input = createInput({ prompt: "/nori-toggle-session-transcripts" });
      const result = await noriToggleSessionTranscripts.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
    });
  });

  describe("toggling behavior", () => {
    it("should add disabled when field does not exist", async () => {
      const input = createInput({ prompt: "/nori-toggle-session-transcripts" });
      const result = await noriToggleSessionTranscripts.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("DISABLED");

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.sendSessionTranscript).toBe("disabled");
    });

    it("should toggle from enabled to disabled", async () => {
      // Set up config with enabled
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          sendSessionTranscript: "enabled",
        }),
      );

      const input = createInput({ prompt: "/nori-toggle-session-transcripts" });
      const result = await noriToggleSessionTranscripts.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("DISABLED");

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.sendSessionTranscript).toBe("disabled");
    });

    it("should toggle from disabled to enabled", async () => {
      // Set up config with disabled
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          sendSessionTranscript: "disabled",
        }),
      );

      const input = createInput({ prompt: "/nori-toggle-session-transcripts" });
      const result = await noriToggleSessionTranscripts.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(result!.reason).toContain("ENABLED");

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.sendSessionTranscript).toBe("enabled");
    });

    it("should preserve other config fields when toggling", async () => {
      // Set up config with additional fields
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "amol" },
          username: "test@example.com",
          autoupdate: "enabled",
          sendSessionTranscript: "enabled",
        }),
      );

      const input = createInput({ prompt: "/nori-toggle-session-transcripts" });
      await noriToggleSessionTranscripts.run({ input });

      const updatedConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
      expect(updatedConfig.profile.baseProfile).toBe("amol");
      expect(updatedConfig.username).toBe("test@example.com");
      expect(updatedConfig.autoupdate).toBe("enabled");
      expect(updatedConfig.sendSessionTranscript).toBe("disabled");
    });
  });

  describe("error handling", () => {
    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-toggle-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-toggle-session-transcripts",
          cwd: noInstallDir,
        });
        const result = await noriToggleSessionTranscripts.run({ input });

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
