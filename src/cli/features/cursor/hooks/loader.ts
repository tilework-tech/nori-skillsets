/**
 * Cursor hooks feature loader
 * Configures Cursor IDE hooks for slash command interception
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import { getCursorDir, getCursorHooksFile } from "@/cli/env.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type {
  Loader,
  ValidationResult,
} from "@/cli/features/loaderRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hooks config directory (relative to this loader)
const HOOKS_CONFIG_DIR = path.join(__dirname, "config");

// Cursor hooks format
type CursorHooksConfig = {
  version: 1;
  hooks: Record<string, Array<{ command: string }>>;
};

// Hook interface
type CursorHookInterface = {
  name: string;
  description: string;
  hookType: string;
  install: () => Promise<{ command: string }>;
};

/**
 * Slash command intercept hook - intercepts /nori-* commands for instant execution
 */
const slashCommandInterceptHook: CursorHookInterface = {
  name: "cursor-before-submit-prompt",
  description: "Intercept slash commands for instant execution",
  hookType: "beforeSubmitPrompt",
  install: async () => {
    const scriptPath = path.join(
      HOOKS_CONFIG_DIR,
      "cursor-before-submit-prompt.js",
    );
    return {
      command: `node ${scriptPath}`,
    };
  },
};

/**
 * Check if a command is a Nori hook command
 * @param args - Arguments object
 * @param args.command - The command string to check
 *
 * @returns True if the command is a Nori cursor hook
 */
const isNoriHookCommand = (args: { command: string }): boolean => {
  const { command } = args;
  return command.includes("cursor-before-submit-prompt");
};

/**
 * Configure hooks for Cursor IDE
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureHooks = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const cursorDir = getCursorDir({ installDir: config.installDir });
  const cursorHooksFile = getCursorHooksFile({ installDir: config.installDir });

  info({
    message: "Configuring hooks for Cursor IDE...",
  });

  // Create .cursor directory if it doesn't exist
  await fs.mkdir(cursorDir, { recursive: true });

  // Initialize hooks file if it doesn't exist
  let hooksConfig: CursorHooksConfig = {
    version: 1,
    hooks: {},
  };

  try {
    const content = await fs.readFile(cursorHooksFile, "utf-8");
    const parsed = JSON.parse(content);
    // Preserve existing hooks structure
    hooksConfig = {
      version: 1,
      hooks: parsed.hooks || {},
    };
  } catch {
    // File doesn't exist or is invalid, use defaults
  }

  // Install all hooks (only free hooks for Cursor)
  const hooks = [slashCommandInterceptHook];

  for (const hook of hooks) {
    const hookConfig = await hook.install();

    // Initialize hook type array if it doesn't exist
    if (!hooksConfig.hooks[hook.hookType]) {
      hooksConfig.hooks[hook.hookType] = [];
    }

    // Remove any existing Nori hooks to avoid duplicates
    hooksConfig.hooks[hook.hookType] = hooksConfig.hooks[hook.hookType].filter(
      (h) => !isNoriHookCommand({ command: h.command }),
    );

    // Add the new hook
    hooksConfig.hooks[hook.hookType].push(hookConfig);
  }

  await fs.writeFile(cursorHooksFile, JSON.stringify(hooksConfig, null, 2));
  success({ message: `✓ Cursor hooks configured in ${cursorHooksFile}` });
  info({ message: "Hooks are configured for:" });
  info({ message: "  - Slash command interception (on beforeSubmitPrompt)" });
};

/**
 * Remove Nori hooks from hooks.json
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeHooks = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const cursorHooksFile = getCursorHooksFile({ installDir: config.installDir });

  info({ message: "Removing Nori hooks from Cursor..." });

  try {
    const content = await fs.readFile(cursorHooksFile, "utf-8");
    const hooksConfig: CursorHooksConfig = JSON.parse(content);

    let modified = false;

    // Remove Nori hooks from each hook type
    for (const hookType of Object.keys(hooksConfig.hooks)) {
      const originalLength = hooksConfig.hooks[hookType].length;
      hooksConfig.hooks[hookType] = hooksConfig.hooks[hookType].filter(
        (h) => !isNoriHookCommand({ command: h.command }),
      );

      if (hooksConfig.hooks[hookType].length !== originalLength) {
        modified = true;
      }

      // Remove empty hook type arrays
      if (hooksConfig.hooks[hookType].length === 0) {
        delete hooksConfig.hooks[hookType];
      }
    }

    if (modified) {
      await fs.writeFile(cursorHooksFile, JSON.stringify(hooksConfig, null, 2));
      success({ message: "✓ Nori hooks removed from hooks.json" });
    } else {
      info({ message: "No Nori hooks found in hooks.json" });
    }
  } catch (err) {
    warn({
      message: `Could not remove hooks from hooks.json: ${err}`,
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
  const { config } = args;
  const cursorHooksFile = getCursorHooksFile({ installDir: config.installDir });
  const errors: Array<string> = [];

  // Check if hooks file exists
  try {
    await fs.access(cursorHooksFile);
  } catch {
    errors.push(`Cursor hooks file not found at ${cursorHooksFile}`);
    errors.push('Run "nori-ai install-cursor" to create the hooks file');
    return {
      valid: false,
      message: "Cursor hooks file not found",
      errors,
    };
  }

  // Read and parse hooks file
  let hooksConfig: CursorHooksConfig;
  try {
    const content = await fs.readFile(cursorHooksFile, "utf-8");
    hooksConfig = JSON.parse(content);
  } catch (err) {
    errors.push("Failed to read or parse hooks.json");
    errors.push(`Error: ${err}`);
    return {
      valid: false,
      message: "Invalid hooks.json",
      errors,
    };
  }

  // Check if beforeSubmitPrompt hook is configured
  if (!hooksConfig.hooks.beforeSubmitPrompt) {
    errors.push("Missing beforeSubmitPrompt hook configuration");
    errors.push('Run "nori-ai install-cursor" to configure hooks');
    return {
      valid: false,
      message: "beforeSubmitPrompt hook not configured",
      errors,
    };
  }

  // Check if Nori slash command hook is present
  const hasSlashCommandHook = hooksConfig.hooks.beforeSubmitPrompt.some((h) =>
    h.command.includes("cursor-before-submit-prompt"),
  );

  if (!hasSlashCommandHook) {
    errors.push("Missing cursor-before-submit-prompt hook");
    errors.push('Run "nori-ai install-cursor" to configure hooks');
    return {
      valid: false,
      message: "Nori slash command hook not configured",
      errors,
    };
  }

  return {
    valid: true,
    message: "Cursor hooks are properly configured",
    errors: null,
  };
};

/**
 * Cursor hooks feature loader
 */
export const cursorHooksLoader: Loader = {
  name: "cursor-hooks",
  description: "Configure Cursor IDE hooks for slash command interception",
  run: async (args: { config: Config }) => {
    const { config } = args;
    await configureHooks({ config });
  },
  uninstall: async (args: { config: Config }) => {
    await removeHooks(args);
  },
  validate,
};
