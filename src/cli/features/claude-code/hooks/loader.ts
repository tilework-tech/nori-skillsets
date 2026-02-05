/**
 * Hooks feature loader
 * Configures Claude Code hooks for automatic memorization and notifications
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
} from "@/cli/features/claude-code/paths.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hooks config directory (relative to this loader)
const HOOKS_CONFIG_DIR = path.join(__dirname, "config");

// Hook configuration types
type HookConfig = {
  event:
    | "SessionEnd"
    | "PreCompact"
    | "Notification"
    | "SessionStart"
    | "UserPromptSubmit"
    | "PreToolUse";
  matcher: "" | "startup" | "auto" | "*" | "Bash";
  hooks: Array<{
    type: "command";
    command: string;
    description: string;
  }>;
};

type HookInterface = {
  name: string;
  description: string;
  install: () => Promise<Array<HookConfig>>;
};

/**
 * Context usage warning hook - warns about excessive permissions context usage
 */
const contextUsageWarningHook: HookInterface = {
  name: "context-usage-warning",
  description: "Warn about excessive context usage from permissions",
  install: async () => {
    const scriptPath = path.join(HOOKS_CONFIG_DIR, "context-usage-warning.js");
    return [
      {
        event: "SessionStart",
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description:
              "Warn about excessive context usage from permissions on session start",
          },
        ],
      },
    ];
  },
};

/**
 * Notification hook - sends desktop notifications
 */
const notifyHook: HookInterface = {
  name: "notify",
  description: "Send desktop notifications",
  install: async () => {
    const scriptPath = path.join(HOOKS_CONFIG_DIR, "notify-hook.sh");
    return [
      {
        event: "Notification",
        matcher: "",
        hooks: [
          {
            type: "command",
            command: scriptPath,
            description: "Send desktop notification when Claude needs input",
          },
        ],
      },
    ];
  },
};

/**
 * Commit-author hook - replace Claude attribution with Nori in git commits
 */
const commitAuthorHook: HookInterface = {
  name: "commit-author",
  description: "Replace Claude Code attribution with Nori in git commits",
  install: async () => {
    const scriptPath = path.join(HOOKS_CONFIG_DIR, "commit-author.js");
    return [
      {
        event: "PreToolUse",
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description:
              "Replace Claude Code co-author attribution with Nori in git commits",
          },
        ],
      },
    ];
  },
};

/**
 * Configure hooks
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureHooks = async (args: { config: Config }): Promise<void> => {
  const { config: _config } = args;
  const claudeDir = getClaudeHomeDir();
  const claudeSettingsFile = getClaudeHomeSettingsFile();

  info({ message: "Configuring hooks..." });

  // Create .claude directory if it doesn't exist
  await fs.mkdir(claudeDir, { recursive: true });

  // Initialize settings file if it doesn't exist
  let settings: any = {};
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch {
    settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
    };
  }

  // Disable Claude Code's built-in co-author byline
  settings.includeCoAuthoredBy = false;

  const hooks = [contextUsageWarningHook, notifyHook, commitAuthorHook];
  const hooksConfig: any = {};

  for (const hook of hooks) {
    const configs = await hook.install();
    for (const hookConfig of configs) {
      if (!hooksConfig[hookConfig.event]) {
        hooksConfig[hookConfig.event] = [];
      }
      hooksConfig[hookConfig.event].push({
        matcher: hookConfig.matcher,
        hooks: hookConfig.hooks,
      });
    }
  }

  // Merge hooks into settings
  settings.hooks = hooksConfig;

  await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
  success({ message: `✓ Hooks configured in ${claudeSettingsFile}` });
};

/**
 * Remove hooks from settings.json
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeHooks = async (args: { config: Config }): Promise<void> => {
  const { config: _config } = args;
  const claudeSettingsFile = getClaudeHomeSettingsFile();

  info({ message: "Removing hooks from Claude Code settings..." });

  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    const settings = JSON.parse(content);

    let modified = false;

    if (settings.hooks) {
      delete settings.hooks;
      modified = true;
    }

    // Remove includeCoAuthoredBy setting
    if (settings.includeCoAuthoredBy === false) {
      delete settings.includeCoAuthoredBy;
      modified = true;
    }

    if (modified) {
      await fs.writeFile(claudeSettingsFile, JSON.stringify(settings, null, 2));
      success({ message: "✓ Hooks removed from settings.json" });
    } else {
      info({ message: "No hooks found in settings.json" });
    }
  } catch (err) {
    warn({
      message: `Could not remove hooks from settings.json: ${err}`,
    });
  }
};

/**
 * Validate hooks configuration
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Validation result
 */
const validate = async (args: {
  config: Config;
}): Promise<ValidationResult> => {
  const { config: _config } = args;
  const claudeSettingsFile = getClaudeHomeSettingsFile();
  const errors: Array<string> = [];

  // Check if settings file exists
  try {
    await fs.access(claudeSettingsFile);
  } catch {
    errors.push(`Settings file not found at ${claudeSettingsFile}`);
    errors.push('Run "nori-skillsets init" to create the settings file');
    return {
      valid: false,
      message: "Claude settings file not found",
      errors,
    };
  }

  // Read and parse settings
  let settings: any;
  try {
    const content = await fs.readFile(claudeSettingsFile, "utf-8");
    settings = JSON.parse(content);
  } catch (err) {
    errors.push("Failed to read or parse settings.json");
    errors.push(`Error: ${err}`);
    return {
      valid: false,
      message: "Invalid settings.json",
      errors,
    };
  }

  // Check if hooks are configured
  if (!settings.hooks) {
    errors.push("No hooks configured in settings.json");
    errors.push('Run "nori-skillsets init" to configure hooks');
    return {
      valid: false,
      message: "Hooks not configured",
      errors,
    };
  }

  // Check for required hook events
  const requiredEvents = ["SessionStart", "PreToolUse"];
  for (const event of requiredEvents) {
    if (!settings.hooks[event]) {
      errors.push(`Missing hook configuration for event: ${event}`);
    }
  }

  // Check if SessionStart has context-usage-warning hook
  if (settings.hooks.SessionStart) {
    const sessionStartHooks = settings.hooks.SessionStart;
    let hasContextUsageWarningHook = false;

    for (const hookConfig of sessionStartHooks) {
      if (hookConfig.hooks) {
        for (const hook of hookConfig.hooks) {
          if (
            hook.command &&
            hook.command.includes("context-usage-warning.js")
          ) {
            hasContextUsageWarningHook = true;
          }
        }
      }
    }

    if (!hasContextUsageWarningHook) {
      errors.push("Missing context-usage-warning hook for SessionStart event");
    }
  }

  // Check if PreToolUse has commit-author hook
  if (settings.hooks.PreToolUse) {
    const preToolUseHooks = settings.hooks.PreToolUse;
    let hasCommitAuthorHook = false;

    for (const hookConfig of preToolUseHooks) {
      if (hookConfig.hooks) {
        for (const hook of hookConfig.hooks) {
          if (hook.command && hook.command.includes("commit-author.js")) {
            hasCommitAuthorHook = true;
          }
        }
      }
    }

    if (!hasCommitAuthorHook) {
      errors.push("Missing commit-author hook for PreToolUse event");
    }
  }

  // Check includeCoAuthoredBy setting
  if (settings.includeCoAuthoredBy !== false) {
    errors.push("includeCoAuthoredBy should be set to false in settings.json");
    errors.push('Run "nori-skillsets init" to configure git settings');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: "Hooks configuration has issues",
      errors,
    };
  }

  return {
    valid: true,
    message: "Hooks are properly configured",
    errors: null,
  };
};

/**
 * Hooks feature loader
 */
export const hooksLoader: Loader = {
  name: "hooks",
  description: "Claude Code hooks (memorization, notifications, etc.)",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await configureHooks({ config });
  },
  uninstall: async (args: { config: Config }) => {
    await removeHooks(args);
  },
  validate,
};
