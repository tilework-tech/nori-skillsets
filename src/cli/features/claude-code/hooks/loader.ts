/**
 * Hooks feature loader
 * Configures Claude Code hooks for automatic memorization and notifications
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { cleanupLegacyHooks } from "@/cli/features/claude-code/hooks/cleanupLegacyHooks.js";
import {
  getClaudeHomeDir,
  getClaudeHomeSettingsFile,
} from "@/cli/features/claude-code/paths.js";

import type { Config } from "@/cli/config.js";
import type { AgentLoader } from "@/cli/features/agentRegistry.js";

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

type CommitAttributionMode = "agent" | "none" | "nori";

const COMMIT_ATTRIBUTION_ENV = "NORI_SKILLSETS_COMMIT_ATTRIBUTION";

const getCommitAttributionMode = (args: {
  env?: NodeJS.ProcessEnv | null;
}): CommitAttributionMode => {
  const { env = process.env } = args;

  switch (env?.[COMMIT_ATTRIBUTION_ENV]) {
    case "agent":
      return "agent";
    case "none":
      return "none";
    case "nori":
      return "nori";
    default:
      return "nori";
  }
};

const removeEmptyAttribution = (args: { settings: any }) => {
  const { settings } = args;

  if (
    settings.attribution == null ||
    typeof settings.attribution !== "object" ||
    Array.isArray(settings.attribution)
  ) {
    return;
  }

  if (settings.attribution.commit === "") {
    delete settings.attribution.commit;
  }

  if (settings.attribution.pr === "") {
    delete settings.attribution.pr;
  }

  if (Object.keys(settings.attribution).length === 0) {
    delete settings.attribution;
  }
};

const applyCommitAttributionSettings = (args: {
  mode: CommitAttributionMode;
  settings: any;
}) => {
  const { mode, settings } = args;

  if (mode === "none") {
    settings.includeCoAuthoredBy = false;
    settings.attribution = {
      ...(typeof settings.attribution === "object" &&
      settings.attribution != null &&
      !Array.isArray(settings.attribution)
        ? settings.attribution
        : {}),
      commit: "",
      pr: "",
    };
    return;
  }

  removeEmptyAttribution({ settings });

  if (mode === "agent") {
    if (settings.includeCoAuthoredBy === false) {
      delete settings.includeCoAuthoredBy;
    }
    return;
  }

  settings.includeCoAuthoredBy = false;
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
 *
 * @returns Label for the settings note, or void on failure
 */
const configureHooks = async (args: {
  config: Config;
}): Promise<string | void> => {
  const { config: _config } = args;

  // Remove stale hooks from previous versions before writing new ones
  await cleanupLegacyHooks();

  const claudeDir = getClaudeHomeDir();
  const claudeSettingsFile = getClaudeHomeSettingsFile();

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

  const commitAttributionMode = getCommitAttributionMode({
    env: process.env,
  });
  applyCommitAttributionSettings({
    mode: commitAttributionMode,
    settings,
  });

  const hooks = [
    contextUsageWarningHook,
    updateCheckHook,
    notifyHook,
    ...(commitAttributionMode === "nori" ? [commitAuthorHook] : []),
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
  return "Hooks";
};

/**
 * Hooks feature loader
 */
export const hooksLoader: AgentLoader = {
  name: "hooks",
  description: "Claude Code hooks (memorization, notifications, etc.)",
  managedFiles: ["settings.json"],
  run: async ({ config }) => {
    return configureHooks({ config });
  },
};
