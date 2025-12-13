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
  getDefaultProfile,
  isPaidInstall,
  getInstalledAgents,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { error, success, info, warn, newline } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Type for prompt configuration returned by generatePromptConfig
 */
export type PromptConfig = {
  installDir: string;
  removeGlobalSettings: boolean;
  selectedAgent: string;
};

/**
 * Format an array of feature names into a human-readable string
 * @param features - Array of feature names
 *
 * @returns A comma-separated string with "and" before the last item
 */
const formatFeatureList = (features: Array<string>): string => {
  if (features.length === 0) {
    return "";
  }
  if (features.length === 1) {
    return features[0];
  }
  if (features.length === 2) {
    return `${features[0]} and ${features[1]}`;
  }
  const allButLast = features.slice(0, -1).join(", ");
  const last = features[features.length - 1];
  return `${allButLast}, and ${last}`;
};

/**
 * Prompt user for confirmation before uninstalling
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.agent - Agent name (optional, will prompt if multiple agents installed)
 *
 * @returns The prompt configuration if user confirms, null to exit
 */
export const generatePromptConfig = async (args: {
  installDir: string;
  agent?: string | null;
}): Promise<PromptConfig | null> => {
  let { installDir } = args;
  const { agent } = args;

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
      newline();

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
      newline();

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
  info({ message: `Uninstalling from: ${installDir}` });
  newline();
  warn({
    message: "This will remove Nori Profiles features from your system.",
  });
  newline();

  // Check for existing configuration
  const existingConfig = await loadConfig({ installDir });

  // Determine which agent to uninstall
  let selectedAgent = agent ?? "claude-code";
  const installedAgents = existingConfig
    ? getInstalledAgents({ config: existingConfig })
    : [];

  if (installedAgents.length > 0) {
    info({
      message: `Installed agents at this location: ${installedAgents.join(", ")}`,
    });
    newline();

    // If no agent specified and multiple agents are installed, prompt user
    if (agent == null && installedAgents.length > 1) {
      info({
        message: "Multiple agents are installed. Select which to uninstall:",
      });
      for (let i = 0; i < installedAgents.length; i++) {
        info({ message: `  ${i + 1}. ${installedAgents[i]}` });
      }
      newline();

      const selection = await promptUser({
        prompt: `Select agent to uninstall (1-${installedAgents.length}), or 'n' to cancel: `,
      });

      if (selection.match(/^[Nn]$/)) {
        info({ message: "Uninstallation cancelled." });
        return null;
      }

      const selectedIndex = parseInt(selection, 10) - 1;
      if (
        isNaN(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= installedAgents.length
      ) {
        info({ message: "Invalid selection. Uninstallation cancelled." });
        return null;
      }

      selectedAgent = installedAgents[selectedIndex];
    } else if (agent == null && installedAgents.length === 1) {
      // Single agent installed, use it
      selectedAgent = installedAgents[0];
    }
  }

  if (existingConfig?.auth) {
    info({ message: "Found paid mode configuration:" });
    info({ message: `  Username: ${existingConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingConfig.auth.organizationUrl}`,
    });
    newline();
  }

  // Get the agent's loaders to show what will be removed
  const agentImpl = AgentRegistry.getInstance().get({ name: selectedAgent });
  const registry = agentImpl.getLoaderRegistry();
  const loaders = registry.getAll();

  info({ message: "The following will be removed:" });
  for (const loader of loaders) {
    info({ message: `  - ${loader.description}` });
  }
  newline();

  const proceed = await promptUser({
    prompt: "Do you want to proceed with uninstallation? (y/n): ",
  });

  if (!proceed.match(/^[Yy]$/)) {
    info({ message: "Uninstallation cancelled." });
    return null;
  }

  newline();

  // Get the agent's global loaders (reusing agentImpl from above)
  const globalLoaders = agentImpl.getGlobalLoaders();

  // If agent has no global features, skip the prompt
  if (globalLoaders.length === 0) {
    return { installDir, removeGlobalSettings: false, selectedAgent };
  }

  // Ask if user wants to remove global settings
  const featureList = formatFeatureList(
    globalLoaders.map((l) => l.humanReadableName),
  );
  warn({
    message: `Global settings (${featureList}) are shared across all Nori installations.`,
  });
  info({
    message: "If you have other Nori installations, you may want to keep them.",
  });
  newline();

  const removeGlobal = await promptUser({
    prompt: `Do you want to remove ${featureList}? (y/n): `,
  });

  const removeGlobalSettings = removeGlobal.match(/^[Yy]$/) ? true : false;

  newline();

  return { installDir, removeGlobalSettings, selectedAgent };
};

/**
 * Remove legacy .nori-notifications.log file (for upgrades from older versions)
 * Note: Current versions use /tmp/nori.log which is not cleaned up on uninstall
 * as it's a shared system temp file.
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
    success({ message: `✓ Removed legacy notifications log: ${logPath}` });
  } catch {
    // File doesn't exist, which is fine
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
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const runUninstall = async (args: {
  removeConfig?: boolean | null;
  removeGlobalSettings?: boolean | null;
  installedVersion?: string | null;
  installDir: string;
  agent?: string | null;
}): Promise<void> => {
  const {
    removeConfig,
    removeGlobalSettings,
    installedVersion,
    installDir,
    agent,
  } = args;
  const agentName = agent ?? "claude-code";

  // Load config (defaults to free if none exists)
  const existingConfig = await loadConfig({ installDir });
  const config = existingConfig ?? {
    profile: getDefaultProfile(),
    installDir,
  };

  // Set the agent being uninstalled so config loader knows what to remove
  // The keys of config.agents indicate which agents to uninstall
  // Preserve existing profile info from the loaded config
  const existingAgentConfig = existingConfig?.agents?.[agentName] ?? {};
  config.agents = { [agentName]: existingAgentConfig };

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
  const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
  const registry = agentImpl.getLoaderRegistry();
  const loaders = registry.getAllReversed();

  // Get the loader names for global features from the agent
  const globalLoaderNames = agentImpl.getGlobalLoaders().map((l) => l.name);

  // Execute uninstallers sequentially to avoid race conditions
  // (hooks and statusline both read/write settings.json)
  for (const loader of loaders) {
    // Skip global feature loaders if removeGlobalSettings is false
    if (!removeGlobalSettings && globalLoaderNames.includes(loader.name)) {
      info({
        message: `Skipping ${loader.name} uninstall (preserving global settings)`,
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

  // Check if there are remaining agents and notify user
  if (removeConfig) {
    const updatedConfig = await loadConfig({ installDir: config.installDir });
    const remainingAgents = updatedConfig
      ? getInstalledAgents({ config: updatedConfig })
      : [];
    if (remainingAgents.length > 0) {
      newline();
      info({
        message: `Other agents are still installed: ${remainingAgents.join(", ")}`,
      });
      info({
        message: "Configuration files have been preserved for these agents.",
      });
      info({
        message: `To uninstall remaining agents, run: nori-ai uninstall --agent ${remainingAgents[0]}`,
      });
    }
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
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const interactive = async (args?: {
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const installDir = normalizeInstallDir({ installDir: args?.installDir });

  // Prompt for confirmation and configuration (including agent selection)
  const result = await generatePromptConfig({ installDir, agent: args?.agent });

  if (result == null) {
    process.exit(0);
  }

  // Show directory being uninstalled from
  info({ message: `Uninstalling from: ${result.installDir}` });
  newline();

  // Run uninstall with user's choices
  await runUninstall({
    removeConfig: true,
    removeGlobalSettings: result.removeGlobalSettings,
    installDir: result.installDir,
    agent: result.selectedAgent,
  });

  // Display completion message
  newline();
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
  newline();

  info({ message: `Uninstalled from: ${result.installDir}` });
  info({ message: "All features have been removed." });
  newline();
  warn({
    message: "Note: You must restart Claude Code for changes to take effect!",
  });
  newline();
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
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const noninteractive = async (args?: {
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const installDir = normalizeInstallDir({ installDir: args?.installDir });

  // Detect agent from config if not explicitly specified
  let agentName = args?.agent ?? null;
  if (agentName == null) {
    const existingConfig = await loadConfig({ installDir });
    const installedAgents = existingConfig
      ? getInstalledAgents({ config: existingConfig })
      : [];
    if (installedAgents.length === 1) {
      // Single agent installed - use it
      agentName = installedAgents[0];
    } else {
      // No agents or multiple agents - default to claude-code
      agentName = "claude-code";
    }
  }

  // Show directory being uninstalled from
  info({ message: `Uninstalling from: ${installDir}` });
  newline();

  // Run uninstall, preserving config and global settings (hooks/statusline/slashcommands)
  await runUninstall({
    removeConfig: false,
    removeGlobalSettings: false,
    installDir,
    agent: agentName,
  });

  // Display completion message
  newline();
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
  newline();

  info({ message: `Uninstalled from: ${installDir}` });
  info({ message: "All features have been removed." });
  newline();
  warn({
    message: "Note: You must restart Claude Code for changes to take effect!",
  });
  newline();
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
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { nonInteractive, installDir, agent } = args || {};

  try {
    if (nonInteractive) {
      await noninteractive({ installDir, agent });
    } else {
      await interactive({ installDir, agent });
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
        agent: globalOpts.agent || null,
      });
    });
};
