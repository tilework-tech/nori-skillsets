/**
 * Tests for nori-toggle-autoupdate intercepted slash command
 */

import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { stripAnsi } from "@/cli/features/test-utils/index.js";

import type { HookInput } from "./types.js";

import { noriToggleAutoupdate } from "./nori-toggle-autoupdate.js";

describe("nori-toggle-autoupdate", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(tmpdir(), "nori-toggle-autoupdate-test-"),
    );

    // Create a config file so getInstallDirs finds this as an installation
    await fs.writeFile(
      path.join(testDir, ".nori-config.json"),
      JSON.stringify({ profile: { baseProfile: "senior-swe" } }),
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
      session_id: "test-session",
      transcript_path: "",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
    };
  };

  describe("matchers", () => {
    it("should have valid regex matchers", () => {
      expect(noriToggleAutoupdate.matchers).toBeInstanceOf(Array);
      expect(noriToggleAutoupdate.matchers.length).toBeGreaterThan(0);

      for (const matcher of noriToggleAutoupdate.matchers) {
        expect(() => new RegExp(matcher)).not.toThrow();
      }
    });
  });

  describe("run function", () => {
    it("should return block decision with informational message", async () => {
      const input = createInput({ prompt: "/nori-toggle-autoupdate" });
      const result = await noriToggleAutoupdate.run({ input });

      expect(result).not.toBeNull();
      expect(result!.decision).toBe("block");
      expect(stripAnsi(result!.reason!)).toContain(
        "Automatic updates have been removed",
      );
    });

    it("should include update instructions in the message", async () => {
      const input = createInput({ prompt: "/nori-toggle-autoupdate" });
      const result = await noriToggleAutoupdate.run({ input });

      expect(result).not.toBeNull();
      expect(stripAnsi(result!.reason!)).toContain(
        "npm install -g nori-skillsets",
      );
      expect(stripAnsi(result!.reason!)).toContain(
        "nori-skillsets switch-skillset",
      );
    });

    it("should not modify the config file", async () => {
      const configPath = path.join(testDir, ".nori-config.json");
      const configBefore = await fs.readFile(configPath, "utf-8");

      const input = createInput({ prompt: "/nori-toggle-autoupdate" });
      await noriToggleAutoupdate.run({ input });

      const configAfter = await fs.readFile(configPath, "utf-8");
      expect(configAfter).toBe(configBefore);
    });
  });

  describe("error handling", () => {
    it("should return error when no installation found", async () => {
      const noInstallDir = await fs.mkdtemp(
        path.join(tmpdir(), "nori-toggle-no-install-"),
      );

      try {
        const input = createInput({
          prompt: "/nori-toggle-autoupdate",
          cwd: noInstallDir,
        });
        const result = await noriToggleAutoupdate.run({ input });

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
