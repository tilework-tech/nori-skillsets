#!/usr/bin/env node

/**
 * Nori Profiles Installer
 *
 * Pipeline-style installer that prompts for configuration and executes feature loaders.
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import * as path from "path";

import { trackEvent } from "@/cli/analytics.js";
import {
  displayNoriBanner,
  displayWelcomeBanner,
  displaySeaweedBed,
} from "@/cli/commands/install/asciiArt.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { promptRegistryAuths } from "@/cli/commands/install/registryAuthPrompt.js";
import {
  loadConfig,
  getDefaultProfile,
  isPaidInstall,
  type Config,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import {
  error,
  success,
  info,
  warn,
  wrapText,
  brightCyan,
  boldWhite,
  gray,
} from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import {
  getCurrentPackageVersion,
  getInstalledVersion,
  saveInstalledVersion,
} from "@/cli/version.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Get available profiles from both source and installed locations
 * Creates a superset of all available profiles
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.agent - AI agent implementation
 *
 * @returns Array of available profiles with names and descriptions
 */
const getAvailableProfiles = async (args: {
  installDir: string;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
}): Promise<Array<{ name: string; description: string }>> => {
  const { installDir, agent } = args;
  const profilesMap = new Map<string, { name: string; description: string }>();

  // Get profiles from package source directory
  const sourceProfiles = await agent.listSourceProfiles();
  for (const profile of sourceProfiles) {
    profilesMap.set(profile.name, profile);
  }

  // Get installed profiles (may include user-added profiles)
  const installedProfileNames = await agent.listProfiles({ installDir });
  for (const name of installedProfileNames) {
    // Only add if not already in source profiles (source takes precedence for description)
    if (!profilesMap.has(name)) {
      profilesMap.set(name, {
        name,
        description: "User-installed profile",
      });
    }
  }

  return Array.from(profilesMap.values());
};

/**
 * Generate prompt configuration by consolidating all prompt logic
 * This function handles all user prompts and returns the complete configuration
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.existingConfig - Existing configuration (if any)
 * @param args.agent - AI agent implementation
 * @param args.agentName - Name of the agent being installed
 *
 * @returns Runtime configuration, or null if user cancels
 */
export const generatePromptConfig = async (args: {
  installDir: string;
  existingConfig: Config | null;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
  agentName: string;
}): Promise<Config | null> => {
  const { installDir, existingConfig, agent, agentName } = args;

  // Check if user wants to reuse existing config
  if (existingConfig?.auth) {
    info({
      message:
        "I found an existing Nori configuration file. Do you want to keep it?",
    });
    console.log();
    info({ message: `  Username: ${existingConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingConfig.auth.organizationUrl}`,
    });
    if (existingConfig.profile) {
      info({
        message: `  Profile: ${existingConfig.profile.baseProfile}`,
      });
    }
    console.log();

    const useExisting = await promptUser({
      prompt: "Keep existing configuration? (y/n): ",
    });

    if (useExisting.match(/^[Yy]$/)) {
      info({ message: "Using existing configuration..." });
      return {
        ...existingConfig,
        profile: existingConfig.profile ?? getDefaultProfile(),
        installDir,
        installedAgents: [agentName],
      };
    }

    console.log();
  }

  // Prompt for credentials
  info({
    message: wrapText({
      text: "Nori Watchtower is our backend service that enables shared knowledge features - search and recall past solutions across your team, save learnings for future sessions, and server-side documentation with versioning. If you have Watchtower credentials (you should have received them from Josh or Amol), enter your email to enable these features. Otherwise, press enter to continue with local-only features.",
    }),
  });
  console.log();

  const username = await promptUser({
    prompt: "Email address (Watchtower) or hit enter to skip: ",
  });

  let auth: {
    username: string;
    password: string;
    organizationUrl: string;
  } | null = null;

  if (username && username.trim() !== "") {
    const password = await promptUser({
      prompt: "Enter your password: ",
      hidden: true,
    });

    const orgUrl = await promptUser({
      prompt:
        "Enter your organization URL (e.g., http://localhost:3000 for local dev): ",
    });

    if (!password || !orgUrl) {
      error({
        message:
          "Password and organization URL are required for backend installation",
      });
      process.exit(1);
    }

    auth = {
      username: username.trim(),
      password: password.trim(),
      organizationUrl: orgUrl.trim(),
    };

    info({ message: "Installing with backend support..." });
    console.log();
  } else {
    info({ message: "Great. Let's move on to selecting your profile." });
    console.log();
  }

  // Get available profiles from both source and installed locations
  const profiles = await getAvailableProfiles({ installDir, agent });

  if (profiles.length === 0) {
    error({ message: "No profiles found. This should not happen." });
    process.exit(1);
  }

  // Display profiles
  info({
    message: wrapText({
      text: "Please select a profile. Each profile contains a complete configuration with skills, subagents, and commands tailored for different use cases.",
    }),
  });
  console.log();

  profiles.forEach((p, i) => {
    const number = brightCyan({ text: `${i + 1}.` });
    const name = boldWhite({ text: p.name });
    const description = gray({ text: p.description });

    console.log(`${number} ${name}`);
    console.log(`   ${description}`);
    console.log();
  });

  // Loop until valid selection
  let selectedProfileName: string;
  while (true) {
    const response = await promptUser({
      prompt: `Select a profile (1-${profiles.length}): `,
    });

    const selectedIndex = parseInt(response) - 1;
    if (selectedIndex >= 0 && selectedIndex < profiles.length) {
      const selected = profiles[selectedIndex];
      info({ message: `Loading "${selected.name}" profile...` });
      selectedProfileName = selected.name;
      break;
    }

    // Invalid selection - show error and loop
    error({
      message: `Invalid selection "${response}". Please enter a number between 1 and ${profiles.length}.`,
    });
    console.log();
  }

  // Prompt for private registry authentication
  console.log();
  const registryAuths = await promptRegistryAuths({
    existingRegistryAuths: existingConfig?.registryAuths ?? null,
  });

  // Build config directly
  return {
    auth: auth ?? null,
    profile: {
      baseProfile: selectedProfileName,
    },
    installDir,
    registryAuths: registryAuths ?? null,
    installedAgents: [agentName],
  };
};

/**
 * Interactive installation mode
 * Prompts user for all configuration and performs installation
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const interactive = async (args?: {
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { skipUninstall, installDir, agent } = args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });
  const agentName = agent ?? "claude-code";

  // Check for ancestor installations that might cause conflicts
  const allInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  });
  // Filter out the current directory to get only ancestors
  const ancestorInstallations = allInstallations.filter(
    (dir) => dir !== normalizedInstallDir,
  );

  if (ancestorInstallations.length > 0) {
    console.log();
    warn({ message: "⚠️  Nori installation detected in ancestor directory!" });
    console.log();
    info({
      message: "Claude Code loads CLAUDE.md files from all parent directories.",
    });
    info({
      message:
        "Having multiple Nori installations can cause duplicate or conflicting configurations.",
    });
    console.log();
    info({ message: "Existing Nori installations found at:" });
    for (const ancestorPath of ancestorInstallations) {
      info({ message: `  • ${ancestorPath}` });
    }
    console.log();
    info({ message: "To remove an existing installation, run:" });
    for (const ancestorPath of ancestorInstallations) {
      info({
        message: `  cd ${ancestorPath} && nori-ai uninstall`,
      });
    }
    console.log();

    const continueAnyway = await promptUser({
      prompt: "Do you want to continue with the installation anyway? (y/n): ",
    });

    if (!continueAnyway.match(/^[Yy]$/)) {
      info({ message: "Installation cancelled." });
      process.exit(0);
    }
    console.log();
  }

  // Handle existing installation cleanup
  if (
    !skipUninstall &&
    hasExistingInstallation({ installDir: normalizedInstallDir })
  ) {
    const previousVersion = getInstalledVersion({
      installDir: normalizedInstallDir,
    });
    info({
      message: `Cleaning up previous installation (v${previousVersion})...`,
    });

    try {
      execSync(
        `nori-ai uninstall --non-interactive --install-dir="${normalizedInstallDir}" --agent="${agentName}"`,
        {
          stdio: "inherit",
        },
      );
    } catch (err: any) {
      info({
        message: `Note: Uninstall at v${previousVersion} failed (may not exist). Continuing with installation...`,
      });
    }
  } else if (skipUninstall) {
    info({
      message: "Skipping uninstall step (preserving existing installation)...",
    });
  } else {
    info({ message: "First-time installation detected. No cleanup needed." });
  }

  // Get the agent implementation
  const agentImpl = AgentRegistry.getInstance().get({ name: agentName });

  // Display banner
  displayNoriBanner();
  console.log();
  info({ message: "Let's personalize Nori to your needs." });
  console.log();

  // Load existing config
  const existingConfig = await loadConfig({
    installDir: normalizedInstallDir,
  });

  // Generate configuration through prompts
  const config = await generatePromptConfig({
    installDir: normalizedInstallDir,
    existingConfig,
    agent: agentImpl,
    agentName,
  });

  if (config == null) {
    info({ message: "Installation cancelled." });
    process.exit(0);
  }

  // Track installation start
  trackEvent({
    eventName: "plugin_install_started",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: false,
    },
  });

  // Create progress marker
  const currentVersion = getCurrentPackageVersion();
  if (currentVersion) {
    const markerPath = path.join(
      process.env.HOME || "~",
      ".nori-install-in-progress",
    );
    writeFileSync(markerPath, currentVersion, "utf-8");
  }

  // Run all loaders (including profiles)
  const registry = agentImpl.getLoaderRegistry();
  const loaders = registry.getAll();

  info({ message: "Installing features..." });
  console.log();

  for (const loader of loaders) {
    await loader.run({ config });
  }

  console.log();

  // Save version
  const finalVersion = getCurrentPackageVersion();
  if (finalVersion) {
    saveInstalledVersion({
      version: finalVersion,
      installDir: normalizedInstallDir,
    });
  }

  // Remove progress marker
  const markerPath = path.join(
    process.env.HOME || "~",
    ".nori-install-in-progress",
  );
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }

  // Track completion
  trackEvent({
    eventName: "plugin_install_completed",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: false,
    },
  });

  displayWelcomeBanner();
  success({
    message:
      "======================================================================",
  });
  success({
    message:
      "        Restart your Claude Code instances to get started           ",
  });
  success({
    message:
      "======================================================================",
  });
  console.log();
  displaySeaweedBed();
  console.log();
};

/**
 * Non-interactive installation mode
 * Uses existing config or defaults, no prompting
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const noninteractive = async (args?: {
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { skipUninstall, installDir, agent } = args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });
  const agentName = agent ?? "claude-code";

  // Check for ancestor installations (warn but continue)
  const allInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  });
  const ancestorInstallations = allInstallations.filter(
    (dir) => dir !== normalizedInstallDir,
  );

  if (ancestorInstallations.length > 0) {
    console.log();
    warn({ message: "⚠️  Nori installation detected in ancestor directory!" });
    console.log();
    info({
      message: "Claude Code loads CLAUDE.md files from all parent directories.",
    });
    info({
      message:
        "Having multiple Nori installations can cause duplicate or conflicting configurations.",
    });
    console.log();
    info({ message: "Existing Nori installations found at:" });
    for (const ancestorPath of ancestorInstallations) {
      info({ message: `  • ${ancestorPath}` });
    }
    console.log();
    info({ message: "To remove an existing installation, run:" });
    for (const ancestorPath of ancestorInstallations) {
      info({
        message: `  cd ${ancestorPath} && nori-ai uninstall`,
      });
    }
    console.log();
    warn({
      message:
        "Continuing with installation in non-interactive mode despite ancestor installations...",
    });
    console.log();
  }

  // Handle existing installation cleanup
  if (
    !skipUninstall &&
    hasExistingInstallation({ installDir: normalizedInstallDir })
  ) {
    const previousVersion = getInstalledVersion({
      installDir: normalizedInstallDir,
    });
    info({
      message: `Cleaning up previous installation (v${previousVersion})...`,
    });

    try {
      execSync(
        `nori-ai uninstall --non-interactive --install-dir="${normalizedInstallDir}" --agent="${agentName}"`,
        {
          stdio: "inherit",
        },
      );
    } catch (err: any) {
      info({
        message: `Note: Uninstall at v${previousVersion} failed (may not exist). Continuing with installation...`,
      });
    }
  } else if (skipUninstall) {
    info({
      message: "Skipping uninstall step (preserving existing installation)...",
    });
  } else {
    info({ message: "First-time installation detected. No cleanup needed." });
  }

  // Load existing config or use defaults
  const existingConfig = await loadConfig({
    installDir: normalizedInstallDir,
  });

  const config: Config = existingConfig
    ? {
        ...existingConfig,
        installedAgents: [agentName],
      }
    : {
        profile: getDefaultProfile(),
        installDir: normalizedInstallDir,
        installedAgents: [agentName],
      };

  // Track installation start
  trackEvent({
    eventName: "plugin_install_started",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: true,
    },
  });

  // Create progress marker
  const currentVersion = getCurrentPackageVersion();
  if (currentVersion) {
    const markerPath = path.join(
      process.env.HOME || "~",
      ".nori-install-in-progress",
    );
    writeFileSync(markerPath, currentVersion, "utf-8");
  }

  // Run all loaders
  const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
  const registry = agentImpl.getLoaderRegistry();
  const loaders = registry.getAll();

  info({ message: "Installing features..." });
  console.log();

  for (const loader of loaders) {
    await loader.run({ config });
  }

  console.log();

  // Save version
  const finalVersion = getCurrentPackageVersion();
  if (finalVersion) {
    saveInstalledVersion({
      version: finalVersion,
      installDir: normalizedInstallDir,
    });
  }

  // Remove progress marker
  const markerPath = path.join(
    process.env.HOME || "~",
    ".nori-install-in-progress",
  );
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }

  // Track completion
  trackEvent({
    eventName: "plugin_install_completed",
    eventParams: {
      install_type: isPaidInstall({ config }) ? "paid" : "free",
      non_interactive: true,
    },
  });

  displayWelcomeBanner();
  success({
    message:
      "======================================================================",
  });
  success({
    message:
      "        Restart your Claude Code instances to get started           ",
  });
  success({
    message:
      "======================================================================",
  });
  console.log();
  displaySeaweedBed();
  console.log();
};

/**
 * Main installer entry point
 * Routes to interactive or non-interactive mode
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.skipUninstall - Whether to skip uninstall step (useful for profile switching)
 * @param args.installDir - Custom installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { nonInteractive, skipUninstall, installDir, agent } = args || {};

  try {
    if (nonInteractive) {
      await noninteractive({ skipUninstall, installDir, agent });
    } else {
      await interactive({ skipUninstall, installDir, agent });
    }
  } catch (err: any) {
    error({ message: err.message });
    process.exit(1);
  }
};

/**
 * Register the 'install' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerInstallCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("install")
    .description("Install Nori Profiles")
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
