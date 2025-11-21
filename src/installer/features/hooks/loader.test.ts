/**
 * Tests for hooks feature loader
 * Verifies install, uninstall, and validate operations
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/installer/config.js";

// Mock the env module to use temp directories
let mockClaudeDir: string;
let mockClaudeSettingsFile: string;

vi.mock("@/installer/env.js", () => ({
  getClaudeDir: () => mockClaudeDir,
  getClaudeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeHomeDir: () => mockClaudeDir,
  getClaudeHomeSettingsFile: () => mockClaudeSettingsFile,
  getClaudeAgentsDir: () => path.join(mockClaudeDir, "agents"),
  getClaudeCommandsDir: () => path.join(mockClaudeDir, "commands"),
  getClaudeMdFile: () => path.join(mockClaudeDir, "CLAUDE.md"),
  getClaudeSkillsDir: () => path.join(mockClaudeDir, "skills"),
  getClaudeProfilesDir: () => path.join(mockClaudeDir, "profiles"),
  MCP_ROOT: "/mock/mcp/root",
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
    it("should configure hooks for paid installation", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

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

      // Verify SessionEnd hooks (should have summarize-notification and summarize)
      expect(settings.hooks.SessionEnd).toBeDefined();
      expect(settings.hooks.SessionEnd.length).toBeGreaterThan(0);

      // Find summarize hooks
      let hasNotificationHook = false;
      let hasSummarizeHook = false;
      for (const hookConfig of settings.hooks.SessionEnd) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (
              hook.command &&
              hook.command.includes("summarize-notification")
            ) {
              hasNotificationHook = true;
            }
            if (hook.command && hook.command.includes("summarize.js")) {
              hasSummarizeHook = true;
            }
          }
        }
      }
      expect(hasNotificationHook).toBe(true);
      expect(hasSummarizeHook).toBe(true);

      // Verify PreCompact hooks
      expect(settings.hooks.PreCompact).toBeDefined();
      expect(settings.hooks.PreCompact.length).toBeGreaterThan(0);

      // Find PreCompact summarize hook
      let hasPreCompactHook = false;
      for (const hookConfig of settings.hooks.PreCompact) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.command && hook.command.includes("summarize.js")) {
              hasPreCompactHook = true;
            }
          }
        }
      }
      expect(hasPreCompactHook).toBe(true);

      // Verify SessionStart hooks (autoupdate)
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);

      let hasAutoupdateHook = false;
      for (const hookConfig of settings.hooks.SessionStart) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.command && hook.command.includes("autoupdate")) {
              hasAutoupdateHook = true;
            }
          }
        }
      }
      expect(hasAutoupdateHook).toBe(true);

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
    });

    it("should configure hooks for free installation", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

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

      // Free mode should NOT have SessionEnd or PreCompact hooks
      expect(settings.hooks.SessionEnd).toBeUndefined();
      expect(settings.hooks.PreCompact).toBeUndefined();

      // Free mode SHOULD have SessionStart hooks (autoupdate)
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);

      let hasAutoupdateHook = false;
      for (const hookConfig of settings.hooks.SessionStart) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.command && hook.command.includes("autoupdate")) {
              hasAutoupdateHook = true;
            }
          }
        }
      }
      expect(hasAutoupdateHook).toBe(true);

      // Free mode SHOULD have Notification hooks
      expect(settings.hooks.Notification).toBeDefined();
      expect(settings.hooks.Notification.length).toBeGreaterThan(0);
    });

    it("should preserve existing settings when adding hooks", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

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
      const config: Config = { installType: "free", installDir: tempDir };

      // First installation
      await hooksLoader.run({ config });

      // Second installation (update)
      await hooksLoader.run({ config });

      // Read updated settings
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify hooks still exist
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.Notification).toBeDefined();
    });

    it("should handle switching from free to paid installation", async () => {
      // First install free version
      const freeConfig: Config = { installType: "free", installDir: tempDir };
      await hooksLoader.run({ config: freeConfig });

      let content = await fs.readFile(settingsPath, "utf-8");
      let settings = JSON.parse(content);

      // Verify free installation (no SessionEnd hooks)
      expect(settings.hooks.SessionEnd).toBeUndefined();

      // Then install paid version
      const paidConfig: Config = { installType: "paid", installDir: tempDir };
      await hooksLoader.run({ config: paidConfig });

      content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);

      // Verify paid installation (has SessionEnd hooks)
      expect(settings.hooks.SessionEnd).toBeDefined();
      expect(settings.hooks.PreCompact).toBeDefined();
    });

    it("should configure UserPromptSubmit hook for quick profile switching (paid)", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

      await hooksLoader.run({ config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify UserPromptSubmit hooks are configured
      expect(settings.hooks.UserPromptSubmit).toBeDefined();
      expect(settings.hooks.UserPromptSubmit.length).toBeGreaterThan(0);

      // Find quick-switch hook
      let hasQuickSwitchHook = false;
      for (const hookConfig of settings.hooks.UserPromptSubmit) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.command && hook.command.includes("quick-switch")) {
              hasQuickSwitchHook = true;
            }
          }
        }
      }
      expect(hasQuickSwitchHook).toBe(true);
    });

    it("should configure nested-install-warning hook for paid installation", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

      await hooksLoader.run({ config });

      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Verify SessionStart hooks include nested-install-warning
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);

      // Find nested-install-warning hook
      let hasNestedWarningHook = false;
      for (const hookConfig of settings.hooks.SessionStart) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (
              hook.command &&
              hook.command.includes("nested-install-warning")
            ) {
              hasNestedWarningHook = true;
            }
          }
        }
      }
      expect(hasNestedWarningHook).toBe(true);
    });

    it("should configure PreToolUse hook for commit-author (paid)", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

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

    it("should configure PreToolUse hook for commit-author (free)", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

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
  });

  describe("uninstall", () => {
    it("should remove hooks from settings.json", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

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
      const config: Config = { installType: "paid", installDir: tempDir };

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
      const config: Config = { installType: "free", installDir: tempDir };

      // Uninstall without installing first
      await expect(hooksLoader.uninstall({ config })).resolves.not.toThrow();
    });

    it("should handle settings.json without hooks gracefully", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

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

  describe("validate", () => {
    it("should return valid for properly installed hooks (paid mode)", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

      // Install
      await hooksLoader.run({ config });

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(true);
      expect(result.message).toContain("properly configured");
      expect(result.errors).toBeNull();
    });

    it("should return valid for properly installed hooks (free mode)", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Install
      await hooksLoader.run({ config });

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(true);
      expect(result.message).toContain("properly configured");
      expect(result.errors).toBeNull();
    });

    it("should return invalid when settings.json does not exist", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Validate without installing
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("not found");
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain("Settings file not found");
    });

    it("should return invalid when includeCoAuthoredBy is not set to false", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

      // Install hooks
      await hooksLoader.run({ config });

      // Modify settings to remove includeCoAuthoredBy
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      delete settings.includeCoAuthoredBy;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("issues");
      expect(result.errors).not.toBeNull();
      expect(
        result.errors?.some((e) => e.includes("includeCoAuthoredBy")),
      ).toBe(true);
    });

    it("should return invalid when includeCoAuthoredBy is set to true", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

      // Install hooks
      await hooksLoader.run({ config });

      // Modify settings to set includeCoAuthoredBy to true
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);
      settings.includeCoAuthoredBy = true;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("issues");
      expect(result.errors).not.toBeNull();
      expect(
        result.errors?.some((e) => e.includes("includeCoAuthoredBy")),
      ).toBe(true);
    });

    it("should return invalid when hooks are not configured", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Create settings.json without hooks
      const settings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("not configured");
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain("No hooks configured");
    });

    it("should return invalid when required hooks are missing (paid mode)", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

      // Create settings.json with incomplete hooks
      const settings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        hooks: {
          SessionEnd: [],
          // Missing PreCompact and SessionStart
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("has issues");
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it("should return invalid when SessionEnd hooks are incomplete (paid mode)", async () => {
      const config: Config = { installType: "paid", installDir: tempDir };

      // Create settings.json with SessionEnd but missing required hooks
      const settings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        hooks: {
          SessionEnd: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "echo test",
                  description: "Test hook",
                },
              ],
            },
          ],
          PreCompact: [],
          SessionStart: [],
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("has issues");
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);

      // Check that specific errors are reported
      const errorMessages = result.errors?.join(" ") || "";
      expect(errorMessages).toContain("summarize-notification");
      expect(errorMessages).toContain("summarize");
    });

    it("should return invalid for free mode when SessionStart hook is missing", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Create settings.json with hooks but missing SessionStart
      const settings = {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        hooks: {
          Notification: [],
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("has issues");
      expect(result.errors).not.toBeNull();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain("SessionStart");
    });

    it("should handle invalid JSON in settings.json", async () => {
      const config: Config = { installType: "free", installDir: tempDir };

      // Create settings.json with invalid JSON
      await fs.writeFile(settingsPath, "not valid json");

      // Validate
      if (hooksLoader.validate == null) {
        throw new Error("validate method not implemented");
      }

      const result = await hooksLoader.validate({ config });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("Invalid settings.json");
      expect(result.errors).not.toBeNull();
    });
  });
});
