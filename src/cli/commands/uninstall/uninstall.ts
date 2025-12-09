#!/usr/bin/env node

/**
 * Nori Profiles Uninstaller
 *
 * Removes all features installed by the Nori Profiles installer.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { trackEvent } from "@/cli/analytics.js";
import {
  loadConfig,
  getConfigPath,
  getDefaultProfile,
  isPaidInstall,
} from "@/cli/config.js";
import { LoaderRegistry } from "@/cli/features/loaderRegistry.js";
import { error, success, info, warn } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { getVersionFilePath } from "@/cli/version.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Type for prompt configuration returned by generatePromptConfig
 */
export type PromptConfig = {
  installDir: string;
  removeGlobalSettings: boolean;
};

/**
 * Prompt user for confirmation before uninstalling
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns The prompt configuration if user confirms, null to exit
 */
export const generatePromptConfig = async (args: {
  installDir: string;
}): Promise<PromptConfig | null> => {
  let { installDir } = args;

  // Get all installations (current + ancestors)
  const allInstallations = getInstallDirs({ currentDir: installDir });
  const hasLocalInstall =
    allInstallations.length > 0 && allInstallations[0] === installDir;

  // If no local installation, check ancestors
  if (!hasLocalInstall) {
    // All found installations are ancestors (current dir not included)
    const ancestors = allInstallations;

    if (ancestors.length === 0) {
      // No installation found anywhere
      info({
        message:
          "No Nori installation found in current or ancestor directories.",
      });
      return null;
    }

    if (ancestors.length === 1) {
      // One ancestor found
      info({ message: "No Nori installation found in current directory." });
      info({
        message: `Found installation in ancestor directory: ${ancestors[0]}`,
      });
      console.log();

      const proceed = await promptUser({
        prompt: "Uninstall from this ancestor location? (y/n): ",
      });

      if (!proceed.match(/^[Yy]$/)) {
        info({ message: "Uninstallation cancelled." });
        return null;
      }

      // Use ancestor directory for uninstall
      installDir = ancestors[0];
    } else {
      // Multiple ancestors found
      info({ message: "No Nori installation found in current directory." });
      info({ message: "Found installations in ancestor directories:" });
      for (let i = 0; i < ancestors.length; i++) {
        info({ message: `  ${i + 1}. ${ancestors[i]}` });
      }
      console.log();

      const selection = await promptUser({
        prompt: `Select installation to uninstall (1-${ancestors.length}), or 'n' to cancel: `,
      });

      if (selection.match(/^[Nn]$/)) {
        info({ message: "Uninstallation cancelled." });
        return null;
      }

      const selectedIndex = parseInt(selection, 10) - 1;
      if (
        isNaN(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= ancestors.length
      ) {
        info({ message: "Invalid selection. Uninstallation cancelled." });
        return null;
      }

      // Use selected ancestor directory
      installDir = ancestors[selectedIndex];
    }
  }

  info({ message: "Nori Profiles Uninstaller" });
  console.log();
  warn({
    message: "This will remove Nori Profiles features from your system.",
  });
  console.log();

  // Check for existing configuration
  const existingConfig = await loadConfig({ installDir });

  if (existingConfig?.auth) {
    info({ message: "Found existing Nori configuration:" });
    info({ message: `  Username: ${existingConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingConfig.auth.organizationUrl}`,
    });
    console.log();
  } else {
    info({
      message:
        "No existing configuration found. Will uninstall free mode features.",
    });
    console.log();
  }

  info({ message: "The following will be removed:" });
  if (existingConfig?.auth) {
    info({ message: "  - nori-knowledge-researcher subagent" });
    info({ message: "  - Automatic memorization hooks" });
  }
  info({ message: "  - Desktop notification hook" });
  info({ message: "  - Skills and profiles" });
  info({ message: "  - Slash commands" });
  info({ message: "  - CLAUDE.md (with confirmation)" });
  info({ message: "  - Nori configuration file" });
  console.log();

  const proceed = await promptUser({
    prompt: "Do you want to proceed with uninstallation? (y/n): ",
  });

  if (!proceed.match(/^[Yy]$/)) {
    info({ message: "Uninstallation cancelled." });
    return null;
  }

  console.log();

  // Ask if user wants to remove global settings (hooks, statusline, and global slashcommands) from ~/.claude
  warn({
    message:
      "Hooks, statusline, and global slash commands are installed in ~/.claude/ and are shared across all Nori installations.",
  });
  info({
    message: "If you have other Nori installations, you may want to keep them.",
  });
  console.log();

  const removeGlobal = await promptUser({
    prompt:
      "Do you want to remove hooks, statusline, and global slash commands from ~/.claude/? (y/n): ",
  });

  const removeGlobalSettings = removeGlobal.match(/^[Yy]$/) ? true : false;

  console.log();

  return { installDir, removeGlobalSettings };
};

/**
 * Remove the .nori-notifications.log file
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 */
const cleanupNotificationsLog = async (args: {
  installDir: string;
}): Promise<void> => {
  const { installDir } = args;
  const logPath = path.join(installDir, ".nori-notifications.log");

  try {
    await fs.access(logPath);
    await fs.unlink(logPath);
    success({ message: `✓ Removed notifications log: ${logPath}` });
  } catch {
    // File doesn't exist, which is fine
  }
};

/**
 * Remove the nori-config.json file and .nori-installed-version file
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 */
const removeConfigFile = async (args: {
  installDir: string;
}): Promise<void> => {
  const { installDir } = args;
  const configPath = getConfigPath({ installDir });
  const versionPath = getVersionFilePath({ installDir });

  info({ message: "Removing Nori configuration files..." });

  try {
    await fs.access(configPath);
    await fs.unlink(configPath);
    success({ message: `✓ Configuration file removed: ${configPath}` });
  } catch {
    info({ message: "Configuration file not found (may not exist)" });
  }

  // Also remove version file
  try {
    await fs.access(versionPath);
    await fs.unlink(versionPath);
    success({ message: `✓ Version file removed: ${versionPath}` });
  } catch {
    info({ message: "Version file not found (may not exist)" });
  }
};

/**
 * Core uninstall logic (can be called programmatically)
 * Preserves config file by default (for upgrades). Only removes config when removeConfig=true.
 * In non-interactive mode, global settings (hooks, statusline, and global slashcommands) are
 * NOT removed from ~/.claude to avoid breaking other Nori installations.
 * @param args - Configuration arguments
 * @param args.removeConfig - Whether to remove the config file (default: false)
 * @param args.removeGlobalSettings - Whether to remove hooks, statusline, and global slashcommands from ~/.claude (default: false)
 * @param args.installedVersion - Version being uninstalled (for logging)
 * @param args.installDir - Installation directory
 */
export const runUninstall = async (args: {
  removeConfig?: boolean | null;
  removeGlobalSettings?: boolean | null;
  installedVersion?: string | null;
  installDir: string;
}): Promise<void> => {
  const { removeConfig, removeGlobalSettings, installedVersion, installDir } =
    args;

  // Load config (defaults to free if none exists)
  const existingConfig = await loadConfig({ installDir });
  const config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir,
  };

  // Log installed version for debugging
  if (installedVersion) {
    info({ message: `Uninstalling version: ${installedVersion}` });
  }

  // Track uninstallation start
  trackEvent({
    eventName: "plugin_uninstall_started",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
    },
  });

  // Load all feature loaders in reverse order for uninstall
  // During install, profiles must run first to create profile directories.
  // During uninstall, profiles must run last so other loaders can still
  // read from profile directories to know what files to remove.
  const registry = LoaderRegistry.getInstance();
  const loaders = registry.getAllReversed();

  // Execute uninstallers sequentially to avoid race conditions
  // (hooks and statusline both read/write settings.json)
  for (const loader of loaders) {
    // Skip hooks, statusline, and slashcommands loaders if removeGlobalSettings is false
    if (
      !removeGlobalSettings &&
      (loader.name === "hooks" ||
        loader.name === "statusline" ||
        loader.name === "slashcommands")
    ) {
      info({
        message: `Skipping ${loader.name} uninstall (preserving ~/.claude/)`,
      });
      continue;
    }

    // Skip config loader if removeConfig is false
    if (!removeConfig && loader.name === "config") {
      info({
        message: "Skipping config uninstall (preserving config file)",
      });
      continue;
    }

    try {
      await loader.uninstall({ config });
    } catch (err: any) {
      warn({
        message: `Failed to uninstall ${loader.name}: ${err.message}`,
      });
    }
  }

  // Clean up standalone files
  await cleanupNotificationsLog({ installDir: config.installDir });

  // Remove config file only if explicitly requested (e.g., from user-initiated uninstall)
  if (removeConfig) {
    console.log();
    await removeConfigFile({ installDir: config.installDir });
  }

  // Track uninstallation completion
  trackEvent({
    eventName: "plugin_uninstall_completed",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
    },
  });
};

/**
 * Interactive uninstallation mode
 * Prompts user for confirmation and configuration choices
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory (optional)
 */
export const interactive = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  const installDir = normalizeInstallDir({ installDir: args?.installDir });

  // Prompt for confirmation and configuration
  const result = await generatePromptConfig({ installDir });

  if (result == null) {
    process.exit(0);
  }

  // Run uninstall with user's choices
  await runUninstall({
    removeConfig: true,
    removeGlobalSettings: result.removeGlobalSettings,
    installDir: result.installDir,
  });

  // Display completion message
  console.log();
  success({
    message:
      "======================================================================",
  });
  success({
    message: "       Nori Profiles Uninstallation Complete!              ",
  });
  success({
    message:
      "======================================================================",
  });
  console.log();

  info({ message: "All features have been removed." });
  console.log();
  warn({
    message: "Note: You must restart Claude Code for changes to take effect!",
  });
  console.log();
  info({
    message: "To completely remove the package, run: npm uninstall -g nori-ai",
  });
};

/**
 * Non-interactive uninstallation mode
 * Preserves config and hooks/statusline for safe upgrades
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory (optional)
 */
export const noninteractive = async (args?: {
  installDir?: string | null;
}): Promise<void> => {
  const installDir = normalizeInstallDir({ installDir: args?.installDir });

  // Run uninstall, preserving config and global settings (hooks/statusline/slashcommands)
  await runUninstall({
    removeConfig: false,
    removeGlobalSettings: false,
    installDir,
  });

  // Display completion message
  console.log();
  success({
    message:
      "======================================================================",
  });
  success({
    message: "       Nori Profiles Uninstallation Complete!              ",
  });
  success({
    message:
      "======================================================================",
  });
  console.log();

  info({ message: "All features have been removed." });
  console.log();
  warn({
    message: "Note: You must restart Claude Code for changes to take effect!",
  });
  console.log();
  info({
    message: "To completely remove the package, run: npm uninstall -g nori-ai",
  });
};

/**
 * Main uninstaller entry point
 * Routes to interactive or non-interactive mode
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode (skips prompts, preserves config)
 * @param args.installDir - Custom installation directory (optional, defaults to cwd)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  installDir?: string | null;
}): Promise<void> => {
  const { nonInteractive, installDir } = args || {};

  try {
    if (nonInteractive) {
      await noninteractive({ installDir });
    } else {
      await interactive({ installDir });
    }
  } catch (err: any) {
    error({ message: err.message });
    process.exit(1);
  }
};

/**
 * Register the 'uninstall' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerUninstallCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("uninstall")
    .description("Uninstall Nori Profiles")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await main({
        nonInteractive: globalOpts.nonInteractive || null,
        installDir: globalOpts.installDir || null,
      });
    });
};
