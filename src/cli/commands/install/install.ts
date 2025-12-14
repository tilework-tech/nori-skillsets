#!/usr/bin/env node

/**
 * Nori Profiles Installer
 *
 * Pipeline-style installer that prompts for configuration and executes feature loaders.
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import * as path from "path";

import semver from "semver";

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
  getAgentProfile,
  isPaidInstall,
  getInstalledAgents,
  type Config,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { migrate } from "@/cli/features/migration.js";
import {
  error,
  success,
  info,
  warn,
  newline,
  raw,
  wrapText,
  brightCyan,
  boldWhite,
  gray,
  setSilentMode,
} from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import {
  getCurrentPackageVersion,
  getInstalledVersion,
  supportsAgentFlag,
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
 * Load existing config and run migrations if needed
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @throws Error if config exists but has no version field
 *
 * @returns Migrated config, or null if no existing config
 */
const loadAndMigrateConfig = async (args: {
  installDir: string;
}): Promise<Config | null> => {
  const { installDir } = args;

  // Load existing config
  const existingConfig = await loadConfig({ installDir });

  // If no config, this is a first-time install - skip migration
  if (existingConfig == null) {
    return null;
  }

  // If config exists but has no version, try to read from deprecated .nori-installed-version file
  if (existingConfig.version == null) {
    const versionFilePath = path.join(installDir, ".nori-installed-version");
    let fallbackVersion: string | null = null;

    if (existsSync(versionFilePath)) {
      const fileContent = readFileSync(versionFilePath, "utf-8").trim();
      if (semver.valid(fileContent) != null) {
        fallbackVersion = fileContent;
      }
    }

    if (fallbackVersion == null) {
      throw new Error(
        "Existing config has no version field. Please run 'nori-ai uninstall' first, then reinstall.",
      );
    }

    // Use the fallback version for migration
    existingConfig.version = fallbackVersion;
  }

  // Run migrations
  const migratedConfig = await migrate({
    previousVersion: existingConfig.version,
    config: existingConfig as unknown as Record<string, unknown>,
    installDir,
  });

  return migratedConfig;
};

/**
 * Generate prompt configuration by consolidating all prompt logic
 * This function handles all user prompts and returns the complete configuration
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.existingConfig - Existing configuration (if any)
 * @param args.agent - AI agent implementation (agent.name is used as the UID)
 *
 * @returns Runtime configuration, or null if user cancels
 */
export const generatePromptConfig = async (args: {
  installDir: string;
  existingConfig: Config | null;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
}): Promise<Config | null> => {
  const { installDir, existingConfig, agent } = args;

  // Check if user wants to reuse existing config
  if (existingConfig?.auth) {
    info({
      message:
        "I found an existing Nori configuration file. Do you want to keep it?",
    });
    newline();
    info({ message: `  Username: ${existingConfig.auth.username}` });
    info({
      message: `  Organization URL: ${existingConfig.auth.organizationUrl}`,
    });
    const existingProfile = getAgentProfile({
      config: existingConfig,
      agentName: agent.name,
    });
    if (existingProfile) {
      info({
        message: `  Profile: ${existingProfile.baseProfile}`,
      });
    }
    newline();

    const useExisting = await promptUser({
      prompt: "Keep existing configuration? (y/n): ",
    });

    if (useExisting.match(/^[Yy]$/)) {
      info({ message: "Using existing configuration..." });
      // Use agent-specific profile first, fall back to default
      const profile =
        getAgentProfile({ config: existingConfig, agentName: agent.name }) ??
        getDefaultProfile();
      return {
        ...existingConfig,
        agents: {
          ...(existingConfig.agents ?? {}),
          [agent.name]: { profile },
        },
        installDir,
      };
    }

    newline();
  }

  // Prompt for credentials
  info({
    message: wrapText({
      text: "Nori Watchtower is our backend service that enables shared knowledge features - search and recall past solutions across your team, save learnings for future sessions, and server-side documentation with versioning. If you have Watchtower credentials (you should have received them from Josh or Amol), enter your email to enable these features. Otherwise, press enter to continue with local-only features.",
    }),
  });
  newline();

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
    newline();
  } else {
    info({ message: "Great. Let's move on to selecting your profile." });
    newline();
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
  newline();

  profiles.forEach((p, i) => {
    const number = brightCyan({ text: `${i + 1}.` });
    const name = boldWhite({ text: p.name });
    const description = gray({ text: p.description });

    raw({ message: `${number} ${name}` });
    raw({ message: `   ${description}` });
    newline();
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
    newline();
  }

  // Prompt for private registry authentication
  newline();
  const registryAuths = await promptRegistryAuths({
    existingRegistryAuths: existingConfig?.registryAuths ?? null,
  });

  // Build config directly
  const profile = { baseProfile: selectedProfileName };
  return {
    auth: auth ?? null,
    agents: {
      ...(existingConfig?.agents ?? {}),
      [agent.name]: { profile },
    },
    installDir,
    registryAuths: registryAuths ?? null,
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
  const agentImpl = AgentRegistry.getInstance().get({
    name: agent ?? "claude-code",
  });

  // Check for ancestor installations that might cause conflicts
  const allInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  });
  // Filter out the current directory to get only ancestors
  const ancestorInstallations = allInstallations.filter(
    (dir) => dir !== normalizedInstallDir,
  );

  if (ancestorInstallations.length > 0) {
    newline();
    warn({ message: "⚠️  Nori installation detected in ancestor directory!" });
    newline();
    info({
      message: "Claude Code loads CLAUDE.md files from all parent directories.",
    });
    info({
      message:
        "Having multiple Nori installations can cause duplicate or conflicting configurations.",
    });
    newline();
    info({ message: "Existing Nori installations found at:" });
    for (const ancestorPath of ancestorInstallations) {
      info({ message: `  • ${ancestorPath}` });
    }
    newline();
    info({ message: "To remove an existing installation, run:" });
    for (const ancestorPath of ancestorInstallations) {
      info({
        message: `  cd ${ancestorPath} && nori-ai uninstall`,
      });
    }
    newline();

    const continueAnyway = await promptUser({
      prompt: "Do you want to continue with the installation anyway? (y/n): ",
    });

    if (!continueAnyway.match(/^[Yy]$/)) {
      info({ message: "Installation cancelled." });
      process.exit(0);
    }
    newline();
  }

  // Handle existing installation cleanup
  // Only uninstall if THIS SPECIFIC agent is already installed
  // Load config and run any necessary migrations
  const existingConfig = await loadAndMigrateConfig({
    installDir: normalizedInstallDir,
  });

  // Determine which agents are installed using agents object keys
  // For backwards compatibility: if no agents but existing installation exists,
  // assume claude-code is installed (old installations didn't track agents)
  let installedAgents = existingConfig
    ? getInstalledAgents({ config: existingConfig })
    : [];
  const existingInstall = hasExistingInstallation({
    installDir: normalizedInstallDir,
  });
  if (installedAgents.length === 0 && existingInstall) {
    installedAgents = ["claude-code"];
  }
  const agentAlreadyInstalled = installedAgents.includes(agentImpl.name);

  if (!skipUninstall && agentAlreadyInstalled) {
    // Get version from config - only when we know an installation exists
    // Note: getInstalledVersion reads from disk, which still has the original version
    // (loadAndMigrateConfig doesn't save to disk, the config loader does that later)
    const previousVersion = await getInstalledVersion({
      installDir: normalizedInstallDir,
    });
    info({
      message: `Cleaning up previous installation (v${previousVersion})...`,
    });

    try {
      let uninstallCmd = `nori-ai uninstall --non-interactive --install-dir="${normalizedInstallDir}"`;
      if (supportsAgentFlag({ version: previousVersion })) {
        uninstallCmd += ` --agent="${agentImpl.name}"`;
      }
      execSync(uninstallCmd, { stdio: "inherit" });
    } catch (err: any) {
      info({
        message: `Note: Uninstall at v${previousVersion} failed (may not exist). Continuing with installation...`,
      });
    }
  } else if (skipUninstall) {
    info({
      message: "Skipping uninstall step (preserving existing installation)...",
    });
  } else if (installedAgents.length > 0) {
    info({
      message: `Adding new agent (preserving existing ${installedAgents.join(", ")} installation)...`,
    });
  } else {
    info({ message: "First-time installation detected. No cleanup needed." });
  }

  // Display banner
  displayNoriBanner();
  newline();
  info({ message: "Let's personalize Nori to your needs." });
  newline();

  // Generate configuration through prompts
  const config = await generatePromptConfig({
    installDir: normalizedInstallDir,
    existingConfig,
    agent: agentImpl,
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
  newline();

  for (const loader of loaders) {
    await loader.run({ config });
  }

  newline();

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
  newline();
  displaySeaweedBed();
  newline();
};

/**
 * Non-interactive installation mode
 * Uses existing config or requires explicit profile, no prompting
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.profile - Profile to use (required if no existing config)
 */
export const noninteractive = async (args?: {
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
  profile?: string | null;
}): Promise<void> => {
  const { skipUninstall, installDir, agent, profile } = args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });
  const agentImpl = AgentRegistry.getInstance().get({
    name: agent ?? "claude-code",
  });

  // Check for ancestor installations (warn but continue)
  const allInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  });
  const ancestorInstallations = allInstallations.filter(
    (dir) => dir !== normalizedInstallDir,
  );

  if (ancestorInstallations.length > 0) {
    newline();
    warn({ message: "⚠️  Nori installation detected in ancestor directory!" });
    newline();
    info({
      message: "Claude Code loads CLAUDE.md files from all parent directories.",
    });
    info({
      message:
        "Having multiple Nori installations can cause duplicate or conflicting configurations.",
    });
    newline();
    info({ message: "Existing Nori installations found at:" });
    for (const ancestorPath of ancestorInstallations) {
      info({ message: `  • ${ancestorPath}` });
    }
    newline();
    info({ message: "To remove an existing installation, run:" });
    for (const ancestorPath of ancestorInstallations) {
      info({
        message: `  cd ${ancestorPath} && nori-ai uninstall`,
      });
    }
    newline();
    warn({
      message:
        "Continuing with installation in non-interactive mode despite ancestor installations...",
    });
    newline();
  }

  // Handle existing installation cleanup
  // Only uninstall if THIS SPECIFIC agent is already installed
  // Load config and run any necessary migrations
  const existingConfig = await loadAndMigrateConfig({
    installDir: normalizedInstallDir,
  });

  // Determine which agents are installed using agents object keys
  // For backwards compatibility: if no agents but existing installation exists,
  // assume claude-code is installed (old installations didn't track agents)
  let installedAgents = existingConfig
    ? getInstalledAgents({ config: existingConfig })
    : [];
  const existingInstall = hasExistingInstallation({
    installDir: normalizedInstallDir,
  });
  if (installedAgents.length === 0 && existingInstall) {
    installedAgents = ["claude-code"];
  }
  const agentAlreadyInstalled = installedAgents.includes(agentImpl.name);

  if (!skipUninstall && agentAlreadyInstalled) {
    // Get version from config - only when we know an installation exists
    // Note: getInstalledVersion reads from disk, which still has the original version
    // (loadAndMigrateConfig doesn't save to disk, the config loader does that later)
    const previousVersion = await getInstalledVersion({
      installDir: normalizedInstallDir,
    });
    info({
      message: `Cleaning up previous installation (v${previousVersion})...`,
    });

    try {
      let uninstallCmd = `nori-ai uninstall --non-interactive --install-dir="${normalizedInstallDir}"`;
      if (supportsAgentFlag({ version: previousVersion })) {
        uninstallCmd += ` --agent="${agentImpl.name}"`;
      }
      execSync(uninstallCmd, { stdio: "inherit" });
    } catch (err: any) {
      info({
        message: `Note: Uninstall at v${previousVersion} failed (may not exist). Continuing with installation...`,
      });
    }
  } else if (skipUninstall) {
    info({
      message: "Skipping uninstall step (preserving existing installation)...",
    });
  } else if (installedAgents.length > 0) {
    info({
      message: `Adding new agent (preserving existing ${installedAgents.join(", ")} installation)...`,
    });
  } else {
    info({ message: "First-time installation detected. No cleanup needed." });
  }

  // Determine profile to use
  // Priority: agent-specific profile > explicit --profile flag
  const agentProfile = existingConfig?.agents?.[agentImpl.name]?.profile;
  const profileToUse =
    agentProfile ?? (profile ? { baseProfile: profile } : null);

  // Require explicit --profile flag if no existing config with profile
  if (profileToUse == null) {
    error({
      message:
        "Non-interactive install requires --profile flag when no existing configuration",
    });
    info({
      message: "Available profiles: senior-swe, amol, product-manager",
    });
    info({
      message:
        "Example: nori-ai install --non-interactive --profile senior-swe",
    });
    process.exit(1);
  }

  const config: Config = existingConfig
    ? {
        ...existingConfig,
        agents: {
          ...(existingConfig.agents ?? {}),
          [agentImpl.name]: {
            profile: profileToUse,
          },
        },
      }
    : {
        agents: {
          [agentImpl.name]: { profile: profileToUse },
        },
        installDir: normalizedInstallDir,
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
  const registry = agentImpl.getLoaderRegistry();
  const loaders = registry.getAll();

  info({ message: "Installing features..." });
  newline();

  for (const loader of loaders) {
    await loader.run({ config });
  }

  newline();

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
  newline();
  displaySeaweedBed();
  newline();
};

/**
 * Main installer entry point
 * Routes to interactive or non-interactive mode
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.skipUninstall - Whether to skip uninstall step (useful for profile switching)
 * @param args.installDir - Custom installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.silent - Whether to suppress all output (implies nonInteractive)
 * @param args.profile - Profile to use for non-interactive install (required if no existing config)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
  silent?: boolean | null;
  profile?: string | null;
}): Promise<void> => {
  const { nonInteractive, skipUninstall, installDir, agent, silent, profile } =
    args || {};

  // Save original console.log and suppress all output if silent mode requested
  const originalConsoleLog = console.log;
  if (silent) {
    setSilentMode({ silent: true });
    console.log = () => undefined;
  }

  try {
    // Silent mode implies non-interactive
    if (nonInteractive || silent) {
      await noninteractive({ skipUninstall, installDir, agent, profile });
    } else {
      await interactive({ skipUninstall, installDir, agent });
    }
  } catch (err: any) {
    error({ message: err.message });
    process.exit(1);
  } finally {
    // Always restore console.log and silent mode when done
    if (silent) {
      console.log = originalConsoleLog;
      setSilentMode({ silent: false });
    }
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
    .option(
      "-p, --profile <name>",
      "Profile to install (required for non-interactive install without existing config)",
    )
    .option(
      "--skip-uninstall",
      "Skip uninstall step (useful for profile switching to preserve user customizations)",
    )
    .action(async (options) => {
      // Get global options from parent
      const globalOpts = program.opts();

      await main({
        nonInteractive: globalOpts.nonInteractive || null,
        skipUninstall: options.skipUninstall || null,
        installDir: globalOpts.installDir || null,
        agent: globalOpts.agent || null,
        silent: globalOpts.silent || null,
        profile: options.profile || null,
      });
    });
};
