/**
 * Tests for hooks feature loader
 * Verifies install and uninstall operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSettingsFile: string;

vi.mock("@/cli/features/claude-code/paths.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
}));

// Import loader after mocking env
import { hooksLoader } from "./loader.js";

describe("hooksLoader", () => {
  let tempDir: string;
  let claudeDir: string;
  let settingsPath: string;

  beforeEach(async () => {
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

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("should configure hooks", async () => {
      const config: Config = { installDir: tempDir };

      await hooksLoader.run({ config });

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

      await hooksLoader.run({ config });

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

    it("should update hooks if already configured", async () => {
      const config: Config = { installDir: tempDir };

      // First installation
      await hooksLoader.run({ config });

      // Second installation (update)
      await hooksLoader.run({ config });

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

      await hooksLoader.run({ config });

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

      await hooksLoader.run({ config });

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
  });

  describe("uninstall", () => {
    it("should remove hooks from settings.json", async () => {
      const config: Config = { installDir: tempDir };

      // Install first
      await hooksLoader.run({ config });

      // Verify hooks exist
      let content = await fs.readFile(settingsPath, "utf-8");
      let settings = JSON.parse(content);
      expect(settings.hooks).toBeDefined();

      // Uninstall
      await hooksLoader.uninstall({ config });

      // Verify hooks are removed
      content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);
      expect(settings.hooks).toBeUndefined();
    });

    it("should preserve other settings when removing hooks", async () => {
      const config: Config = { installDir: tempDir };

      // Create settings with hooks and other content
      await hooksLoader.run({ config });

      let content = await fs.readFile(settingsPath, "utf-8");
      let settings = JSON.parse(content);
      settings.someOtherSetting = "preserved value";
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Uninstall
      await hooksLoader.uninstall({ config });

      // Verify other settings are preserved
      content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);
      expect(settings.someOtherSetting).toBe("preserved value");
      expect(settings.hooks).toBeUndefined();
    });

    it("should handle missing settings.json gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Uninstall without installing first
      await expect(hooksLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should handle settings.json without hooks gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Create settings.json without hooks
      const settings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Uninstall
      await expect(hooksLoader.uninstall({ config })).resolves.not.toThrow();

      // Verify settings.json still exists and is unchanged
      const content = await fs.readFile(settingsPath, "utf-8");
      const updatedSettings = JSON.parse(content);
      expect(updatedSettings.$schema).toBe(
        "https://json.schemastore.org/claude-code-settings.json",
      );
    });
  });
});
