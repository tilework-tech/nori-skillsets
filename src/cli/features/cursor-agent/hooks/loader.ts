/**
 * Hooks feature loader for cursor-agent
 * Configures Cursor IDE hooks for desktop notifications
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  getCursorDir,
  getCursorHooksFile,
} from "@/cli/features/cursor-agent/paths.js";
import { success, info, warn } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader, ValidationResult } from "@/cli/features/agentRegistry.js";

// Get directory of this loader file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hooks config directory (relative to this loader)
const HOOKS_CONFIG_DIR = path.join(__dirname, "config");

// Cursor hooks.json schema types
type CursorHook = {
  command: string;
};

type CursorHooksConfig = {
  version: 1;
  hooks: {
    [eventName: string]: Array<CursorHook>;
  };
};

/**
 * Get the notify hook script path
 *
 * @returns Path to the notify-hook.sh script
 */
const getNotifyHookScriptPath = (): string => {
  return path.join(HOOKS_CONFIG_DIR, "notify-hook.sh");
};

/**
 * Check if a hook command is a nori notify hook
 *
 * @param args - Arguments
 * @param args.command - Hook command string
 *
 * @returns True if the command is a nori notify hook
 */
const isNoriNotifyHook = (args: { command: string }): boolean => {
  const { command } = args;
  return command.includes("notify-hook.sh");
};

/**
 * Configure hooks for Cursor IDE
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const configureHooks = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const cursorDir = getCursorDir({ installDir: config.installDir });
  const hooksFile = getCursorHooksFile({ installDir: config.installDir });

  info({ message: "Configuring Cursor hooks for desktop notifications..." });

  // Create .cursor directory if it doesn't exist
  await fs.mkdir(cursorDir, { recursive: true });

  // Initialize or read existing hooks.json
  let hooksConfig: CursorHooksConfig = {
    version: 1,
    hooks: {},
  };

  try {
    const content = await fs.readFile(hooksFile, "utf-8");
    const parsed = JSON.parse(content);
    // Preserve existing hooks
    hooksConfig = {
      version: 1,
      hooks: parsed.hooks ?? {},
    };
  } catch {
    // File doesn't exist or is invalid, use default
  }

  // Get the notify hook script path
  const notifyScriptPath = getNotifyHookScriptPath();

  // Initialize stop hooks array if not present
  if (!hooksConfig.hooks.stop) {
    hooksConfig.hooks.stop = [];
  }

  // Check if notify hook already exists (avoid duplicates)
  const hasExistingNotifyHook = hooksConfig.hooks.stop.some((hook) =>
    isNoriNotifyHook({ command: hook.command }),
  );

  if (!hasExistingNotifyHook) {
    // Add notify hook for stop event
    // Pass NORI_INSTALL_DIR so the script knows where to write logs
    hooksConfig.hooks.stop.push({
      command: `NORI_INSTALL_DIR="${config.installDir}" ${notifyScriptPath}`,
    });
  }

  // Write hooks.json
  await fs.writeFile(hooksFile, JSON.stringify(hooksConfig, null, 2));
  success({ message: `✓ Hooks configured in ${hooksFile}` });
  info({
    message:
      "Desktop notifications will appear when Cursor agent completes (stop event)",
  });
};

/**
 * Remove nori hooks from hooks.json
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const removeHooks = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const hooksFile = getCursorHooksFile({ installDir: config.installDir });

  info({ message: "Removing Nori hooks from Cursor hooks.json..." });

  try {
    const content = await fs.readFile(hooksFile, "utf-8");
    const hooksConfig: CursorHooksConfig = JSON.parse(content);

    let modified = false;

    // Remove nori notify hooks from stop event
    if (hooksConfig.hooks.stop) {
      const originalLength = hooksConfig.hooks.stop.length;
      hooksConfig.hooks.stop = hooksConfig.hooks.stop.filter(
        (hook) => !isNoriNotifyHook({ command: hook.command }),
      );

      if (hooksConfig.hooks.stop.length !== originalLength) {
        modified = true;
      }

      // Clean up empty stop array
      if (hooksConfig.hooks.stop.length === 0) {
        delete hooksConfig.hooks.stop;
      }
    }

    if (modified) {
      await fs.writeFile(hooksFile, JSON.stringify(hooksConfig, null, 2));
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
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Validation result
 */
const validate = async (args: {
  config: Config;
}): Promise<ValidationResult> => {
  const { config } = args;
  const hooksFile = getCursorHooksFile({ installDir: config.installDir });
  const errors: Array<string> = [];

  // Check if hooks.json exists
  try {
    await fs.access(hooksFile);
  } catch {
    errors.push(`Hooks file not found at ${hooksFile}`);
    errors.push('Run "nori-ai install --agent cursor-agent" to create hooks');
    return {
      valid: false,
      message: "Cursor hooks.json not found",
      errors,
    };
  }

  // Read and parse hooks.json
  let hooksConfig: CursorHooksConfig;
  try {
    const content = await fs.readFile(hooksFile, "utf-8");
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

  // Check if stop hooks are configured
  if (!hooksConfig.hooks?.stop || hooksConfig.hooks.stop.length === 0) {
    errors.push("No stop hooks configured in hooks.json");
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to configure hooks',
    );
    return {
      valid: false,
      message: "stop hooks not configured",
      errors,
    };
  }

  // Check if notify-hook is present
  const hasNotifyHook = hooksConfig.hooks.stop.some((hook) =>
    isNoriNotifyHook({ command: hook.command }),
  );

  if (!hasNotifyHook) {
    errors.push("Missing notify-hook in stop event");
    errors.push(
      'Run "nori-ai install --agent cursor-agent" to configure hooks',
    );
    return {
      valid: false,
      message: "notify-hook not configured",
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
 * Hooks feature loader for cursor-agent
 */
export const hooksLoader: Loader = {
  name: "hooks",
  description: "Configure Cursor hooks for desktop notifications",
  run: async (args: { config: Config }) => {
    await configureHooks(args);
  },
  uninstall: async (args: { config: Config }) => {
    await removeHooks(args);
  },
  validate,
};
