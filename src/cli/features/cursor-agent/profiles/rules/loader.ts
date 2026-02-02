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
import { copyDirWithTemplateSubstitution } from "@/cli/features/cursor-agent/template.js";
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
 * Get list of rule directory names from profile config
 * Used to identify Nori-managed rules (vs user-created rules)
 *
 * @param args - Configuration arguments
 * @param args.configDir - Path to the profile's rules config directory
 *
 * @returns Array of rule directory names from the profile config
 */
const getProfileRuleNames = async (args: {
  configDir: string;
}): Promise<Array<string>> => {
  const { configDir } = args;
  try {
    const entries = await fs.readdir(configDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // Config directory doesn't exist - no rules to manage
    return [];
  }
};

/**
 * Install rules from profile
 * Preserves user-created rules by only removing/updating Nori-managed rules
 *
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

  // Get list of Nori-managed rules from profile config
  const profileRuleNames = await getProfileRuleNames({ configDir });

  // Only remove Nori-managed rules (preserve user-created rules)
  for (const ruleName of profileRuleNames) {
    const ruleDir = path.join(cursorRulesDir, ruleName);
    await fs.rm(ruleDir, { recursive: true, force: true });
  }

  // Create rules directory if it doesn't exist
  await fs.mkdir(cursorRulesDir, { recursive: true });

  // Copy all rules from config directory with template substitution
  try {
    const cursorDir = getCursorDir({ installDir: config.installDir });
    await copyDirWithTemplateSubstitution({
      src: configDir,
      dest: cursorRulesDir,
      installDir: cursorDir,
    });
    success({ message: "✓ Installed rules" });
  } catch {
    info({ message: "No rules found in profile" });
  }
};

/**
 * Uninstall rules
 * Preserves user-created rules by only removing Nori-managed rules
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallRules = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Removing Cursor rules..." });

  // Get profile name from config (default to amol for cursor-agent)
  const agentProfile = getAgentProfile({ config, agentName: "cursor-agent" });
  const profileName = agentProfile?.baseProfile || "amol";
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });
  const cursorRulesDir = getCursorRulesDir({ installDir: config.installDir });

  // Get list of Nori-managed rules from profile config
  const profileRuleNames = await getProfileRuleNames({ configDir });

  let removedCount = 0;

  // Only remove Nori-managed rules (preserve user-created rules)
  for (const ruleName of profileRuleNames) {
    const ruleDir = path.join(cursorRulesDir, ruleName);
    try {
      await fs.access(ruleDir);
      await fs.rm(ruleDir, { recursive: true, force: true });
      removedCount++;
    } catch {
      // Rule not found, which is fine
    }
  }

  if (removedCount > 0) {
    success({ message: `✓ Removed ${removedCount} Nori rule(s)` });
  } else {
    info({ message: "No Nori rules found to remove" });
  }

  // Remove rules directory only if it's empty
  try {
    const files = await fs.readdir(cursorRulesDir);
    if (files.length === 0) {
      await fs.rmdir(cursorRulesDir);
      success({ message: `✓ Removed empty rules directory` });
    }
  } catch {
    // Directory doesn't exist or couldn't be removed, which is fine
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
    errors.push('Run "nori-skillsets init" to install rules');
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
