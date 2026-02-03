/**
 * Tests for transcript hook installer
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  installTranscriptHook,
  removeTranscriptHook,
  isTranscriptHookInstalled,
} from "./hookInstaller.js";

describe("hookInstaller", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let settingsFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-installer-test-"));

    // Create mock .claude directory
    await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
    settingsFile = path.join(tempDir, ".claude", "settings.json");

    // Save original HOME and override for tests
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    // Restore HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("installTranscriptHook", () => {
    test("adds hook to empty settings.json", async () => {
      // Create empty settings file
      await fs.writeFile(settingsFile, JSON.stringify({}));

      await installTranscriptHook();

      const content = await fs.readFile(settingsFile, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.SessionEnd).toBeDefined();
      expect(settings.hooks.SessionEnd.length).toBeGreaterThan(0);

      // Find our hook
      const ourHook = settings.hooks.SessionEnd.find(
        (h: { hooks: Array<{ command: string }> }) =>
          h.hooks.some((hook: { command: string }) =>
            hook.command.includes("transcript-done-marker"),
          ),
      );
      expect(ourHook).toBeDefined();
    });

    test("adds hook when other hooks already exist", async () => {
      // Create settings with existing hooks
      const existingSettings = {
        hooks: {
          SessionEnd: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "node /path/to/other-hook.js",
                  description: "Some other hook",
                },
              ],
            },
          ],
          SessionStart: [
            {
              matcher: "startup",
              hooks: [
                {
                  type: "command",
                  command: "node /path/to/startup-hook.js",
                  description: "Startup hook",
                },
              ],
            },
          ],
        },
      };
      await fs.writeFile(settingsFile, JSON.stringify(existingSettings));

      await installTranscriptHook();

      const content = await fs.readFile(settingsFile, "utf-8");
      const settings = JSON.parse(content);

      // Other hooks should still exist
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SessionEnd.length).toBe(2);

      // Our hook should be added
      const ourHook = settings.hooks.SessionEnd.find(
        (h: { hooks: Array<{ command: string }> }) =>
          h.hooks.some((hook: { command: string }) =>
            hook.command.includes("transcript-done-marker"),
          ),
      );
      expect(ourHook).toBeDefined();
    });

    test("is idempotent - does not duplicate hook", async () => {
      await fs.writeFile(settingsFile, JSON.stringify({}));

      // Install twice
      await installTranscriptHook();
      await installTranscriptHook();

      const content = await fs.readFile(settingsFile, "utf-8");
      const settings = JSON.parse(content);

      // Count our hooks
      const ourHooks = settings.hooks.SessionEnd.filter(
        (h: { hooks: Array<{ command: string }> }) =>
          h.hooks.some((hook: { command: string }) =>
            hook.command.includes("transcript-done-marker"),
          ),
      );
      expect(ourHooks.length).toBe(1);
    });

    test("creates settings.json if it does not exist", async () => {
      // Don't create settings file - let installer create it

      await installTranscriptHook();

      const content = await fs.readFile(settingsFile, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.SessionEnd).toBeDefined();
    });
  });

  describe("removeTranscriptHook", () => {
    test("removes only our hook, leaves others intact", async () => {
      // Create settings with our hook and another hook
      const existingSettings = {
        hooks: {
          SessionEnd: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "node /path/to/other-hook.js",
                  description: "Some other hook",
                },
              ],
            },
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "node /path/to/transcript-done-marker.js",
                  description: "Transcript done marker hook",
                },
              ],
            },
          ],
        },
      };
      await fs.writeFile(settingsFile, JSON.stringify(existingSettings));

      await removeTranscriptHook();

      const content = await fs.readFile(settingsFile, "utf-8");
      const settings = JSON.parse(content);

      // Other hook should still exist
      expect(settings.hooks.SessionEnd.length).toBe(1);
      expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain(
        "other-hook",
      );

      // Our hook should be gone
      const ourHook = settings.hooks.SessionEnd.find(
        (h: { hooks: Array<{ command: string }> }) =>
          h.hooks.some((hook: { command: string }) =>
            hook.command.includes("transcript-done-marker"),
          ),
      );
      expect(ourHook).toBeUndefined();
    });

    test("handles missing settings.json gracefully", async () => {
      // Don't create settings file

      await expect(removeTranscriptHook()).resolves.not.toThrow();
    });

    test("handles settings.json with no hooks gracefully", async () => {
      await fs.writeFile(
        settingsFile,
        JSON.stringify({ someOtherSetting: true }),
      );

      await expect(removeTranscriptHook()).resolves.not.toThrow();
    });
  });

  describe("isTranscriptHookInstalled", () => {
    test("returns true when hook is installed", async () => {
      await fs.writeFile(settingsFile, JSON.stringify({}));
      await installTranscriptHook();

      const installed = await isTranscriptHookInstalled();
      expect(installed).toBe(true);
    });

    test("returns false when hook is not installed", async () => {
      await fs.writeFile(settingsFile, JSON.stringify({}));

      const installed = await isTranscriptHookInstalled();
      expect(installed).toBe(false);
    });

    test("returns false when settings.json does not exist", async () => {
      const installed = await isTranscriptHookInstalled();
      expect(installed).toBe(false);
    });
  });
});
