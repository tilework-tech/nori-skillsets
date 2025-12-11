/**
 * Rules feature loader for cursor-agent
 * Installs rule files to ~/.cursor/rules/
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getAgentProfile } from "@/cli/config.js";
import {
  getCursorDir,
  getCursorRulesDir,
} from "@/cli/features/cursor-agent/paths.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { ValidationResult } from "@/cli/features/agentRegistry.js";
import type { CursorProfileLoader } from "@/cli/features/cursor-agent/profiles/profileLoaderRegistry.js";

/**
 * Get config directory for rules based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile to load rules from
 * @param args.installDir - Installation directory
 *
 * @returns Path to the rules config directory for the profile
 */
const getConfigDir = (args: {
  profileName: string;
  installDir: string;
}): string => {
  const { profileName, installDir } = args;
  const cursorDir = getCursorDir({ installDir });
  return path.join(cursorDir, "profiles", profileName, "rules");
};

/**
 * Install rules from profile
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installRules = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Installing Cursor rules..." });

  // Get profile name from config (default to amol for cursor-agent)
  const agentProfile = getAgentProfile({ config, agentName: "cursor-agent" });
  const profileName = agentProfile?.baseProfile || "amol";
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });
  const cursorRulesDir = getCursorRulesDir({ installDir: config.installDir });

  // Remove existing rules directory if it exists
  await fs.rm(cursorRulesDir, { recursive: true, force: true });

  // Create rules directory
  await fs.mkdir(cursorRulesDir, { recursive: true });

  // Copy all rules from config directory
  try {
    await fs.cp(configDir, cursorRulesDir, { recursive: true });
    success({ message: "✓ Installed rules" });
  } catch {
    info({ message: "No rules found in profile" });
  }
};

/**
 * Uninstall rules
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallRules = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Removing Cursor rules..." });

  const cursorRulesDir = getCursorRulesDir({ installDir: config.installDir });

  try {
    await fs.access(cursorRulesDir);
    await fs.rm(cursorRulesDir, { recursive: true, force: true });
    success({ message: "✓ Removed rules directory" });
  } catch {
    info({
      message: "Rules directory not found (may not have been installed)",
    });
  }
};

/**
 * Validate rules installation
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 *
 * @returns Validation result
 */
const validate = async (args: {
  config: Config;
}): Promise<ValidationResult> => {
  const { config } = args;
  const errors: Array<string> = [];

  const cursorRulesDir = getCursorRulesDir({ installDir: config.installDir });

  // Check if rules directory exists
  try {
    await fs.access(cursorRulesDir);
  } catch {
    errors.push(`Rules directory not found at ${cursorRulesDir}`);
    errors.push('Run "nori-ai install --agent cursor-agent" to install rules');
    return {
      valid: false,
      message: "Rules directory not found",
      errors,
    };
  }

  return {
    valid: true,
    message: "Rules are properly installed",
    errors: null,
  };
};

/**
 * Rules feature loader
 */
export const rulesLoader: CursorProfileLoader = {
  name: "rules",
  description: "Install rule files for Cursor",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await installRules({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await uninstallRules({ config });
  },
  validate,
};
