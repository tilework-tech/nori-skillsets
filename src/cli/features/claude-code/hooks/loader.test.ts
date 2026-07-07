/**
 * Tests for hooks feature loader
 * Verifies install operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

const COMMIT_ATTRIBUTION_ENV = "NORI_SKILLSETS_COMMIT_ATTRIBUTION";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSettingsFile: string;

vi.mock("@/cli/features/claude-code/paths.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getClaudeHomeDir: () => mockClaudeDir,
    getClaudeHomeSettingsFile: () => mockClaudeSettingsFile,
    getClaudeHomeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  };
});

// Mock cleanupLegacyHooks to prevent it from touching real ~/.claude/settings.json
vi.mock("@/cli/features/claude-code/hooks/cleanupLegacyHooks.js", () => ({
  cleanupLegacyHooks: vi.fn().mockResolvedValue(undefined),
}));

// Import loader after mocking env
import { hooksLoader } from "./loader.js";

describe("hooksLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let settingsPath: string;
  let originalCommitAttributionEnv: string | undefined;

  beforeEach(async () => {
    originalCommitAttributionEnv = process.env[COMMIT_ATTRIBUTION_ENV];
    delete process.env[COMMIT_ATTRIBUTION_ENV];

    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hooks-test-"));
    claudeDir = path.join(tempDir, ".claude");
    settingsPath = path.join(claudeDir, "settings.json");

    // Set mock paths
    mockClaudeDir = claudeDir;
    mockClaudeSettingsFile = settingsPath;

    // Create directories
    await fs.mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    if (originalCommitAttributionEnv == null) {
      delete process.env[COMMIT_ATTRIBUTION_ENV];
    } else {
      process.env[COMMIT_ATTRIBUTION_ENV] = originalCommitAttributionEnv;
    }

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    const runHooksLoader = async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      return JSON.parse(content);
    };

    const hasHookCommand = (args: {
      settings: any;
      event: string;
      commandPart: string;
    }) => {
      const { settings, event, commandPart } = args;
      const eventHooks = settings.hooks[event] ?? [];

      return eventHooks.some((hookConfig: any) =>
        (hookConfig.hooks ?? []).some(
          (hook: any) =>
            typeof hook.command === "string" &&
            hook.command.includes(commandPart),
        ),
      );
    };

    it("should configure hooks", async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ agent: {} as any, config });

      // Verify settings.json exists
      const exists = await fs
        .access(settingsPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Read and parse settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify hooks are configured
      expect(settings.hooks).toBeDefined();

      // Verify SessionStart hooks (context-usage-warning)
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);

      let hasContextUsageWarningHook = false;
      for (const hookConfig of settings.hooks.SessionStart) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (
              hook.command &&
              hook.command.includes("context-usage-warning")
            ) {
              hasContextUsageWarningHook = true;
            }
          }
        }
      }
      expect(hasContextUsageWarningHook).toBe(true);

      // Verify PreToolUse hooks (commit-author)
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PreToolUse.length).toBeGreaterThan(0);

      let hasCommitAuthorHook = false;
      for (const hookConfig of settings.hooks.PreToolUse) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.command && hook.command.includes("commit-author")) {
              hasCommitAuthorHook = true;
            }
          }
        }
      }
      expect(hasCommitAuthorHook).toBe(true);

      // Verify Notification hooks
      expect(settings.hooks.Notification).toBeDefined();
      expect(settings.hooks.Notification.length).toBeGreaterThan(0);

      let hasNotifyHook = false;
      for (const hookConfig of settings.hooks.Notification) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.command && hook.command.includes("notify-hook")) {
              hasNotifyHook = true;
            }
          }
        }
      }
      expect(hasNotifyHook).toBe(true);

      // Should NOT have SessionEnd hooks (statistics hooks were removed)
      expect(settings.hooks.SessionEnd).toBeUndefined();

      // Should NOT have PreCompact hooks (summarize hooks were removed)
      expect(settings.hooks.PreCompact).toBeUndefined();

      // Should NOT have UserPromptSubmit hooks (slash command intercept was removed)
      expect(settings.hooks.UserPromptSubmit).toBeUndefined();
    });

    it("should preserve existing settings when adding hooks", async () => {
      const config: Config = { installDir: tempDir };

      // Create settings.json with existing content
      const existingSettings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        someOtherSetting: "value",
      };
      await fs.writeFile(
        settingsPath,
        JSON.stringify(existingSettings, null, 2),
      );

      await hooksLoader.run({ agent: {} as any, config });

      // Read and parse settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify existing settings are preserved
      expect(settings.someOtherSetting).toBe("value");
      expect(settings.$schema).toBe(
        "https://json.schemastore.org/claude-code-settings.json",
      );

      // Verify hooks are added
      expect(settings.hooks).toBeDefined();
    });

    it("should preserve user-authored hooks when installing", async () => {
      const config: Config = { installDir: tempDir };

      // User has their own hooks configured before Nori installs
      const userSettings = {
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [
                {
                  type: "command",
                  command: "/home/user/bin/my-own-hook.sh",
                  description: "User hook that must survive",
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "/home/user/bin/audit.sh",
                  description: "User audit hook",
                },
              ],
            },
          ],
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(userSettings, null, 2));

      await hooksLoader.run({ agent: {} as any, config });

      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));

      // User hooks survive, in their original groups
      const allSessionStartCommands = settings.hooks.SessionStart.flatMap(
        (group: any) => group.hooks.map((h: any) => h.command),
      );
      expect(allSessionStartCommands).toContain(
        "/home/user/bin/my-own-hook.sh",
      );
      expect(settings.hooks.PostToolUse).toEqual(
        userSettings.hooks.PostToolUse,
      );

      // Nori hooks are added alongside
      expect(
        allSessionStartCommands.some((c: string) =>
          c.includes("context-usage-warning"),
        ),
      ).toBe(true);
    });

    it("should not duplicate Nori hooks across repeated installs alongside user hooks", async () => {
      const config: Config = { installDir: tempDir };

      const userSettings = {
        hooks: {
          Notification: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "/home/user/bin/my-notify.sh",
                  description: "User notification hook",
                },
              ],
            },
          ],
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(userSettings, null, 2));

      await hooksLoader.run({ agent: {} as any, config });
      await hooksLoader.run({ agent: {} as any, config });

      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      const notificationCommands = settings.hooks.Notification.flatMap(
        (group: any) => group.hooks.map((h: any) => h.command),
      );

      // User hook still present exactly once
      expect(
        notificationCommands.filter(
          (c: string) => c === "/home/user/bin/my-notify.sh",
        ),
      ).toHaveLength(1);
      // Nori notify hook present exactly once despite two installs
      expect(
        notificationCommands.filter((c: string) => c.includes("notify-hook")),
      ).toHaveLength(1);
    });

    it("should update hooks if already configured", async () => {
      const config: Config = { installDir: tempDir };

      // First installation
      await hooksLoader.run({ agent: {} as any, config });

      // Second installation (update)
      await hooksLoader.run({ agent: {} as any, config });

      // Read updated settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify hooks still exist
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.Notification).toBeDefined();
    });

    it("should configure PreToolUse hook for commit-author", async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify PreToolUse hooks include commit-author
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PreToolUse.length).toBeGreaterThan(0);

      // Find commit-author hook
      let hasCommitAuthorHook = false;
      for (const hookConfig of settings.hooks.PreToolUse) {
        if (hookConfig.matcher === "Bash" && hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.command && hook.command.includes("commit-author")) {
              hasCommitAuthorHook = true;
              expect(hook.description).toContain("Nori");
            }
          }
        }
      }
      expect(hasCommitAuthorHook).toBe(true);
    });

    it("should configure context-usage-warning hook", async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ agent: {} as any, config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify SessionStart hooks include context-usage-warning
      expect(settings.hooks.SessionStart).toBeDefined();

      let hasContextUsageWarningHook = false;
      for (const hookConfig of settings.hooks.SessionStart) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (
              hook.command &&
              hook.command.includes("context-usage-warning")
            ) {
              hasContextUsageWarningHook = true;
            }
          }
        }
      }
      expect(hasContextUsageWarningHook).toBe(true);
    });

    it("should use Nori commit attribution when the env var is unset", async () => {
      const settings = await runHooksLoader();

      expect(
        hasHookCommand({
          settings,
          event: "PreToolUse",
          commandPart: "commit-author",
        }),
      ).toBe(true);
      expect(settings.includeCoAuthoredBy).toBe(false);
      expect(settings.attribution).toBeUndefined();
    });

    it("should use Nori commit attribution when the env var is nori", async () => {
      process.env[COMMIT_ATTRIBUTION_ENV] = "nori";

      const settings = await runHooksLoader();

      expect(
        hasHookCommand({
          settings,
          event: "PreToolUse",
          commandPart: "commit-author",
        }),
      ).toBe(true);
      expect(settings.includeCoAuthoredBy).toBe(false);
    });

    it("should fall back to Nori commit attribution for an invalid env var value", async () => {
      process.env[COMMIT_ATTRIBUTION_ENV] = "invalid";

      const settings = await runHooksLoader();

      expect(
        hasHookCommand({
          settings,
          event: "PreToolUse",
          commandPart: "commit-author",
        }),
      ).toBe(true);
      expect(settings.includeCoAuthoredBy).toBe(false);
    });

    it("should disable Nori and Claude commit attribution when the env var is none", async () => {
      process.env[COMMIT_ATTRIBUTION_ENV] = "none";

      const settings = await runHooksLoader();

      expect(
        hasHookCommand({
          settings,
          event: "PreToolUse",
          commandPart: "commit-author",
        }),
      ).toBe(false);
      expect(
        hasHookCommand({
          settings,
          event: "SessionStart",
          commandPart: "context-usage-warning",
        }),
      ).toBe(true);
      expect(
        hasHookCommand({
          settings,
          event: "Notification",
          commandPart: "notify-hook",
        }),
      ).toBe(true);
      expect(settings.includeCoAuthoredBy).toBe(false);
      expect(settings.attribution).toEqual({
        commit: "",
        pr: "",
      });
    });

    it("should let the agent provider own commit attribution when the env var is agent", async () => {
      process.env[COMMIT_ATTRIBUTION_ENV] = "agent";
      await fs.writeFile(
        settingsPath,
        JSON.stringify(
          {
            includeCoAuthoredBy: false,
            attribution: {
              commit: "",
              pr: "",
            },
            someOtherSetting: "value",
          },
          null,
          2,
        ),
      );

      const settings = await runHooksLoader();

      expect(
        hasHookCommand({
          settings,
          event: "PreToolUse",
          commandPart: "commit-author",
        }),
      ).toBe(false);
      expect(settings.includeCoAuthoredBy).toBeUndefined();
      expect(settings.attribution).toBeUndefined();
      expect(settings.someOtherSetting).toBe("value");
    });

    it("should preserve custom agent attribution settings when the env var is agent", async () => {
      process.env[COMMIT_ATTRIBUTION_ENV] = "agent";
      await fs.writeFile(
        settingsPath,
        JSON.stringify(
          {
            attribution: {
              commit: "Custom commit attribution",
              pr: "Custom PR attribution",
            },
          },
          null,
          2,
        ),
      );

      const settings = await runHooksLoader();

      expect(
        hasHookCommand({
          settings,
          event: "PreToolUse",
          commandPart: "commit-author",
        }),
      ).toBe(false);
      expect(settings.attribution).toEqual({
        commit: "Custom commit attribution",
        pr: "Custom PR attribution",
      });
    });

    it("does not clobber a settings.json that exists but is corrupt", async () => {
      const config: Config = { installDir: tempDir };
      const corrupt = '{ "permissions": { "allow": [ broken';
      await fs.writeFile(settingsPath, corrupt);

      await expect(
        hooksLoader.run({ agent: {} as any, config }),
      ).rejects.toThrow();

      expect(await fs.readFile(settingsPath, "utf-8")).toBe(corrupt);
    });
  });
});
