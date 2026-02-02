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
 * Autoupdate hook - checks for package updates
 */
const autoupdateHook: HookInterface = {
  name: "autoupdate",
  description: "Check for Nori Profiles updates",
  install: async () => {
    const scriptPath = path.join(HOOKS_CONFIG_DIR, "autoupdate.js");
    return [
      {
        event: "SessionStart",
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description: "Check for Nori Profiles updates on session start",
          },
        ],
      },
    ];
  },
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
 * Slash command intercept hook - instant execution of slash commands without LLM inference
 */
const slashCommandInterceptHook: HookInterface = {
  name: "slash-command-intercept",
  description: "Instant execution of intercepted slash commands",
  install: async () => {
    const scriptPath = path.join(
      HOOKS_CONFIG_DIR,
      "slash-command-intercept.js",
    );
    return [
      {
        event: "UserPromptSubmit",
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description: "Intercept slash commands for instant execution",
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
 * Statistics notification hook - displays user notification for statistics calculation
 */
const statisticsNotificationHook: HookInterface = {
  name: "statistics-notification",
  description: "Notify user about statistics calculation",
  install: async () => {
    const scriptPath = path.join(
      HOOKS_CONFIG_DIR,
      "statistics-notification.js",
    );
    return [
      {
        event: "SessionEnd",
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description: "Notify user that statistics are being calculated",
          },
        ],
      },
    ];
  },
};

/**
 * Statistics hook - calculates and displays session statistics
 */
const statisticsHook: HookInterface = {
  name: "statistics",
  description: "Calculate and display session usage statistics",
  install: async () => {
    const scriptPath = path.join(HOOKS_CONFIG_DIR, "statistics.js");
    return [
      {
        event: "SessionEnd",
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description: "Calculate and display session usage statistics",
          },
        ],
      },
    ];
  },
};

/**
 * Onboarding wizard welcome hook - welcomes users to the onboarding wizard
 */
const onboardingWizardWelcomeHook: HookInterface = {
  name: "onboarding-wizard-welcome",
  description: "Welcome users to the onboarding wizard profile",
  install: async () => {
    const scriptPath = path.join(
      HOOKS_CONFIG_DIR,
      "onboarding-wizard-welcome.js",
    );
    return [
      {
        event: "SessionStart",
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description:
              "Welcome users when onboarding-wizard profile is active",
          },
        ],
      },
    ];
  },
};

/**
 * Worktree cleanup hook - warns about excessive git worktree disk usage
 */
const worktreeCleanupHook: HookInterface = {
  name: "worktree-cleanup",
  description: "Warn about excessive git worktree disk usage",
  install: async () => {
    const scriptPath = path.join(HOOKS_CONFIG_DIR, "worktree-cleanup.js");
    return [
      {
        event: "SessionStart",
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description:
              "Warn about excessive git worktree disk usage on session start",
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

  const hooks = [
    statisticsNotificationHook,
    statisticsHook,
    autoupdateHook,
    contextUsageWarningHook,
    worktreeCleanupHook,
    onboardingWizardWelcomeHook,
    notifyHook,
    slashCommandInterceptHook,
    commitAuthorHook,
  ];
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
  const requiredEvents = ["SessionEnd", "SessionStart"];
  for (const event of requiredEvents) {
    if (!settings.hooks[event]) {
      errors.push(`Missing hook configuration for event: ${event}`);
    }
  }

  // Check if SessionEnd has required hooks (statistics)
  if (settings.hooks.SessionEnd) {
    const sessionEndHooks = settings.hooks.SessionEnd;
    let hasStatisticsNotificationHook = false;
    let hasStatisticsHook = false;

    for (const hookConfig of sessionEndHooks) {
      if (hookConfig.hooks) {
        for (const hook of hookConfig.hooks) {
          if (
            hook.command &&
            hook.command.includes("statistics-notification.js")
          ) {
            hasStatisticsNotificationHook = true;
          }
          if (
            hook.command &&
            hook.command.includes("statistics.js") &&
            !hook.command.includes("statistics-notification")
          ) {
            hasStatisticsHook = true;
          }
        }
      }
    }

    if (!hasStatisticsNotificationHook) {
      errors.push("Missing statistics-notification hook for SessionEnd event");
    }
    if (!hasStatisticsHook) {
      errors.push("Missing statistics hook for SessionEnd event");
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
