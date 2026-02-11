/**
 * Tests for legacy hooks cleanup
 *
 * Verifies that stale hook entries from removed nori-skillsets scripts
 * are cleaned up from ~/.claude/settings.json
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { cleanupLegacyHooks } from "./cleanupLegacyHooks.js";

describe("cleanupLegacyHooks", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let claudeDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cleanup-legacy-hooks-test-"),
    );
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    claudeDir = path.join(tempDir, ".claude");
    settingsPath = path.join(claudeDir, "settings.json");
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should remove stale nori-skillsets hooks from settings.json", async () => {
    fs.mkdirSync(claudeDir, { recursive: true });
    const settings = {
      hooks: {
        SessionEnd: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "node /Users/goss/.nvm/versions/node/v22.20.0/lib/node_modules/nori-skillsets/build/src/cli/features/claude-code/hooks/config/statistics.js",
                description: "Track statistics",
              },
              {
                type: "command",
                command:
                  "node /Users/goss/.nvm/versions/node/v22.20.0/lib/node_modules/nori-skillsets/build/src/cli/features/claude-code/hooks/config/statistics-notification.js",
                description: "Statistics notification",
              },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await cleanupLegacyHooks();

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    // All hooks were stale, so the entire hooks section should be pruned
    expect(result.hooks).toBeUndefined();
  });

  it("should remove stale hooks at legacy path locations", async () => {
    fs.mkdirSync(claudeDir, { recursive: true });
    const settings = {
      hooks: {
        SessionEnd: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "node /usr/local/lib/node_modules/nori-skillsets/build/src/cli/features/hooks/config/statistics.js",
                description: "Track statistics (legacy path)",
              },
            ],
          },
        ],
        PreCompact: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "node /usr/local/lib/node_modules/nori-skillsets/build/src/cli/features/hooks/config/summarize.js",
                description: "Summarize (legacy path)",
              },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await cleanupLegacyHooks();

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(result.hooks).toBeUndefined();
  });

  it("should preserve current valid hooks while removing stale ones", async () => {
    fs.mkdirSync(claudeDir, { recursive: true });
    const settings = {
      someOtherSetting: "value",
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command:
                  "node /path/to/nori-skillsets/build/src/cli/features/claude-code/hooks/config/context-usage-warning.js",
                description: "Context usage warning",
              },
            ],
          },
        ],
        SessionEnd: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "node /path/to/nori-skillsets/build/src/cli/features/claude-code/hooks/config/statistics.js",
                description: "Track statistics",
              },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await cleanupLegacyHooks();

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    // Valid hook preserved
    expect(result.hooks.SessionStart).toBeDefined();
    expect(result.hooks.SessionStart[0].hooks).toHaveLength(1);
    expect(result.hooks.SessionStart[0].hooks[0].command).toContain(
      "context-usage-warning",
    );
    // Stale hook removed
    expect(result.hooks.SessionEnd).toBeUndefined();
    // Other settings preserved
    expect(result.someOtherSetting).toBe("value");
  });

  it("should never touch non-nori-skillsets hooks", async () => {
    fs.mkdirSync(claudeDir, { recursive: true });
    const settings = {
      hooks: {
        SessionEnd: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: "node /home/user/my-custom-scripts/statistics.js",
                description: "My custom statistics hook",
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: "python /home/user/hooks/slash-command-intercept.js",
                description: "My custom slash command intercept",
              },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await cleanupLegacyHooks();

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    // Both hooks should be untouched since they don't contain "nori-skillsets"
    expect(result.hooks.SessionEnd[0].hooks).toHaveLength(1);
    expect(result.hooks.SessionEnd[0].hooks[0].command).toContain(
      "my-custom-scripts",
    );
    expect(result.hooks.UserPromptSubmit[0].hooks).toHaveLength(1);
  });

  it("should prune empty matcher groups and events after removal", async () => {
    fs.mkdirSync(claudeDir, { recursive: true });
    const settings = {
      hooks: {
        SessionEnd: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "node /path/to/nori-skillsets/build/src/cli/features/claude-code/hooks/config/statistics.js",
                description: "Track statistics",
              },
              {
                type: "command",
                command:
                  "node /path/to/nori-skillsets/build/src/cli/features/claude-code/hooks/config/statistics-notification.js",
                description: "Statistics notification",
              },
            ],
          },
        ],
        PreCompact: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "node /path/to/nori-skillsets/build/src/cli/features/claude-code/hooks/config/summarize.js",
                description: "Summarize",
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "node /path/to/nori-skillsets/build/src/cli/features/claude-code/hooks/config/slash-command-intercept.js",
                description: "Slash command intercept",
              },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await cleanupLegacyHooks();

    const result = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    // All hooks were stale and all events should be fully pruned
    expect(result.hooks).toBeUndefined();
  });

  it("should not error when settings.json does not exist", async () => {
    // Don't create .claude directory or settings.json
    await expect(cleanupLegacyHooks()).resolves.not.toThrow();
  });

  it("should not modify file when hooks section is missing", async () => {
    fs.mkdirSync(claudeDir, { recursive: true });
    const settings = { someOtherSetting: "value" };
    const originalContent = JSON.stringify(settings, null, 2);
    fs.writeFileSync(settingsPath, originalContent);

    await cleanupLegacyHooks();

    const afterContent = fs.readFileSync(settingsPath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("should not error on invalid JSON in settings.json", async () => {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, "this is not json {{{");

    await expect(cleanupLegacyHooks()).resolves.not.toThrow();

    // File should be unchanged
    const content = fs.readFileSync(settingsPath, "utf-8");
    expect(content).toBe("this is not json {{{");
  });
});
