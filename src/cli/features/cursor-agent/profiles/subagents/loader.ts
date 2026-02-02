/**
 * Subagents feature loader for cursor-agent
 * Installs subagent prompt files to ~/.cursor/subagents/
 */

import * as fs from "fs/promises";
import * as path from "path";

import { getAgentProfile } from "@/cli/config.js";
import {
  getCursorDir,
  getCursorSubagentsDir,
} from "@/cli/features/cursor-agent/paths.js";
import { copyDirWithTemplateSubstitution } from "@/cli/features/cursor-agent/template.js";
import { success, info } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { ValidationResult } from "@/cli/features/agentRegistry.js";
import type { CursorProfileLoader } from "@/cli/features/cursor-agent/profiles/profileLoaderRegistry.js";

/**
 * Get config directory for subagents based on selected profile
 *
 * @param args - Configuration arguments
 * @param args.profileName - Name of the profile to load subagents from
 * @param args.installDir - Installation directory
 *
 * @returns Path to the subagents config directory for the profile
 */
const getConfigDir = (args: {
  profileName: string;
  installDir: string;
}): string => {
  const { profileName, installDir } = args;
  const cursorDir = getCursorDir({ installDir });
  return path.join(cursorDir, "profiles", profileName, "subagents");
};

/**
 * Install subagents from profile
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installSubagents = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Installing Cursor subagents..." });

  // Get profile name from config (default to amol for cursor-agent)
  const agentProfile = getAgentProfile({ config, agentName: "cursor-agent" });
  const profileName = agentProfile?.baseProfile || "amol";
  const configDir = getConfigDir({
    profileName,
    installDir: config.installDir,
  });
  const cursorSubagentsDir = getCursorSubagentsDir({
    installDir: config.installDir,
  });

  // Check if profile has subagents directory
  try {
    await fs.access(configDir);
  } catch {
    info({ message: "No subagents found in profile" });
    return;
  }

  // Remove existing subagents directory if it exists
  await fs.rm(cursorSubagentsDir, { recursive: true, force: true });

  // Create subagents directory
  await fs.mkdir(cursorSubagentsDir, { recursive: true });

  // Copy all subagents from config directory with template substitution
  try {
    const cursorDir = getCursorDir({ installDir: config.installDir });
    await copyDirWithTemplateSubstitution({
      src: configDir,
      dest: cursorSubagentsDir,
      installDir: cursorDir,
    });
    success({ message: "✓ Installed subagents" });
  } catch {
    info({ message: "No subagents found in profile" });
  }
};

/**
 * Uninstall subagents
 *
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallSubagents = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  info({ message: "Removing Cursor subagents..." });

  const cursorSubagentsDir = getCursorSubagentsDir({
    installDir: config.installDir,
  });

  try {
    await fs.access(cursorSubagentsDir);
    await fs.rm(cursorSubagentsDir, { recursive: true, force: true });
    success({ message: "✓ Removed subagents directory" });
  } catch {
    info({
      message: "Subagents directory not found (may not have been installed)",
    });
  }
};

/**
 * Validate subagents installation
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

  const cursorSubagentsDir = getCursorSubagentsDir({
    installDir: config.installDir,
  });

  // Check if subagents directory exists
  try {
    await fs.access(cursorSubagentsDir);
  } catch {
    errors.push(`Subagents directory not found at ${cursorSubagentsDir}`);
    errors.push('Run "nori-skillsets init" to install subagents');
    return {
      valid: false,
      message: "Subagents directory not found",
      errors,
    };
  }

  return {
    valid: true,
    message: "Subagents are properly installed",
    errors: null,
  };
};

/**
 * Subagents feature loader
 */
export const subagentsLoader: CursorProfileLoader = {
  name: "subagents",
  description: "Install subagent prompt files for Cursor",
  install: async (args: { config: Config }) => {
    const { config } = args;
    await installSubagents({ config });
  },
  uninstall: async (args: { config: Config }) => {
    const { config } = args;
    await uninstallSubagents({ config });
  },
  validate,
};
