#!/usr/bin/env node

/**
 * Nori Profiles Uninstaller
 *
 * Removes all features installed by the Nori Profiles installer.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { trackEvent } from "@/installer/analytics.js";
import {
  loadDiskConfig,
  generateConfig,
  getConfigPath,
  type Config,
} from "@/installer/config.js";
import {
  getClaudeAgentsDir,
  getClaudeCommandsDir,
  getClaudeProfilesDir,
} from "@/installer/env.js";
import { LoaderRegistry } from "@/installer/features/loaderRegistry.js";
import { error, success, info, warn } from "@/installer/logger.js";
import { promptUser } from "@/installer/prompt.js";
import { getVersionFilePath } from "@/installer/version.js";
import {
  normalizeInstallDir,
  hasNoriInstallation,
  findAncestorInstallations,
} from "@/utils/path.js";

/**
 * Prompt user for confirmation before uninstalling
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns The configuration and removeHooksAndStatusline flag if user confirms, null to exit
 */
const promptForUninstall = async (args: {
  installDir: string;
}): Promise<{
  config: Config;
  removeHooksAndStatusline: boolean;
} | null> => {
  let { installDir } = args;

  // Check if there's a Nori installation in the current directory
  const hasLocalInstall = hasNoriInstallation({ dir: installDir });

  // If no local installation, check ancestors
  if (!hasLocalInstall) {
    const ancestors = findAncestorInstallations({ installDir });

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
  const existingDiskConfig = await loadDiskConfig({ installDir });

  if (existingDiskConfig?.auth) {
    info({ message: "Found existing Nori configuration:" });
    info({ message: `  Username: ${existingDiskConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingDiskConfig.auth.organizationUrl}`,
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
  if (existingDiskConfig?.auth) {
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

  // Ask if user wants to remove hooks and statusline from ~/.claude
  warn({
    message:
      "Hooks and statusline are installed in ~/.claude/settings.json and are shared across all Nori installations.",
  });
  info({
    message: "If you have other Nori installations, you may want to keep them.",
  });
  console.log();

  const removeHooks = await promptUser({
    prompt:
      "Do you want to remove hooks and statusline from ~/.claude/settings.json? (y/n): ",
  });

  const removeHooksAndStatusline = removeHooks.match(/^[Yy]$/) ? true : false;

  console.log();

  const config = generateConfig({ diskConfig: existingDiskConfig, installDir });

  return { config, removeHooksAndStatusline };
};

/**
 * Remove empty directories that were created by Nori loaders
 * Only removes directories if they are empty (preserves user-created content)
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration with installDir
 */
const cleanupEmptyDirectories = async (args: {
  config: Config;
}): Promise<void> => {
  const { config } = args;
  info({ message: "Cleaning up empty directories..." });

  const directoriesToCheck = [
    getClaudeAgentsDir({ installDir: config.installDir }),
    getClaudeCommandsDir({ installDir: config.installDir }),
    getClaudeProfilesDir({ installDir: config.installDir }),
  ];

  for (const dir of directoriesToCheck) {
    try {
      const files = await fs.readdir(dir);
      if (files.length === 0) {
        await fs.rmdir(dir);
        success({ message: `✓ Removed empty directory: ${dir}` });
      } else {
        info({
          message: `Directory not empty, preserving: ${dir} (${files.length} files)`,
        });
      }
    } catch {
      // Directory doesn't exist, which is fine
    }
  }
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
 * In non-interactive mode, hooks and statusline are NOT removed from ~/.claude to avoid
 * breaking other Nori installations.
 * @param args - Configuration arguments
 * @param args.removeConfig - Whether to remove the config file (default: false)
 * @param args.removeHooksAndStatusline - Whether to remove hooks and statusline from ~/.claude (default: false)
 * @param args.installedVersion - Version being uninstalled (for logging)
 * @param args.installDir - Installation directory
 */
export const runUninstall = async (args: {
  removeConfig?: boolean | null;
  removeHooksAndStatusline?: boolean | null;
  installedVersion?: string | null;
  installDir: string;
}): Promise<void> => {
  const {
    removeConfig,
    removeHooksAndStatusline,
    installedVersion,
    installDir,
  } = args;

  // Load config to determine install type (defaults to free if none exists)
  const existingDiskConfig = await loadDiskConfig({ installDir });
  const config = generateConfig({ diskConfig: existingDiskConfig, installDir });

  // Log installed version for debugging
  if (installedVersion) {
    info({ message: `Uninstalling version: ${installedVersion}` });
  }

  // Track uninstallation start
  trackEvent({
    eventName: "plugin_uninstall_started",
    eventParams: {
      install_type: config.installType,
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
    // Skip hooks and statusline loaders if removeHooksAndStatusline is false
    if (
      !removeHooksAndStatusline &&
      (loader.name === "hooks" || loader.name === "statusline")
    ) {
      info({
        message: `Skipping ${loader.name} uninstall (preserving ~/.claude/settings.json)`,
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

  // Clean up empty directories and standalone files
  await cleanupEmptyDirectories({ config });
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
      install_type: config.installType,
    },
  });
};

/**
 * Main uninstaller entry point
 * This is a CLI entry point that accepts optional installDir
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode (skips prompts, preserves config)
 * @param args.installDir - Custom installation directory (optional, defaults to cwd)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  installDir?: string | null;
}): Promise<void> => {
  const { nonInteractive } = args || {};
  // Normalize installDir at entry point
  const installDir = normalizeInstallDir({ installDir: args?.installDir });

  try {
    // Initialize analytics

    if (nonInteractive) {
      // Non-interactive mode: preserve config and do not remove hooks/statusline
      // (for upgrades/autoupdate - avoid breaking other installations)
      await runUninstall({
        removeConfig: false,
        removeHooksAndStatusline: false,
        installDir,
      });
    } else {
      // Interactive mode: prompt for confirmation and remove config
      const result = await promptForUninstall({ installDir });

      if (result == null) {
        process.exit(0);
      }

      // Run uninstall, remove config, and conditionally remove hooks/statusline based on user choice
      await runUninstall({
        removeConfig: true,
        removeHooksAndStatusline: result.removeHooksAndStatusline,
        installDir,
      });
    }

    // Uninstallation complete
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
      message:
        "To completely remove the package, run: npm uninstall -g nori-ai",
    });
  } catch (err: any) {
    error({ message: err.message });
    process.exit(1);
  }
};

// Run the uninstaller if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
