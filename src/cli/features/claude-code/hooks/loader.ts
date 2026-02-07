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
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader } from "@/cli/features/agentRegistry.js";

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
 * Update check hook - notify about available updates at session start
 */
const updateCheckHook: HookInterface = {
  name: "update-check",
  description: "Check for nori-skillsets updates at session start",
  install: async () => {
    const scriptPath = path.join(HOOKS_CONFIG_DIR, "update-check.js");
    return [
      {
        event: "SessionStart",
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: `node ${scriptPath}`,
            description:
              "Check for nori-skillsets updates and notify if available",
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

  const hooks = [
    contextUsageWarningHook,
    updateCheckHook,
    notifyHook,
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
 * Hooks feature loader
 */
export const hooksLoader: Loader = {
  name: "hooks",
  description: "Claude Code hooks (memorization, notifications, etc.)",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await configureHooks({ config });
  },
};
