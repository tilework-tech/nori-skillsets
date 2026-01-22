#!/usr/bin/env node

/**
 * Nori Profiles Installer
 *
 * Orchestrates the installation process by delegating to:
 * 1. init - Set up folders and capture existing config
 * 2. onboard - Select profile and configure authentication
 * 3. switch-profile - Apply the profile (runs feature loaders)
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";

import { initMain } from "@/cli/commands/init/init.js";
import {
  displayNoriBanner,
  displayWelcomeBanner,
  displaySeaweedBed,
} from "@/cli/commands/install/asciiArt.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { onboardMain } from "@/cli/commands/onboard/onboard.js";
import { loadConfig, getInstalledAgents, type Config } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import {
  buildCLIEventParams,
  getUserId,
  sendAnalyticsEvent,
} from "@/cli/installTracking.js";
import { error, success, info, newline, setSilentMode } from "@/cli/logger.js";
import {
  getCurrentPackageVersion,
  getInstalledVersion,
  supportsAgentFlag,
} from "@/cli/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Get the path for the progress marker file
 * @returns The absolute path to the progress marker file
 */
const getMarkerPath = (): string => {
  return path.join(os.homedir(), ".nori-install-in-progress");
};

/**
 * Create progress marker file to track installation in progress
 * @returns The marker path if created, null otherwise
 */
const createProgressMarker = (): string | null => {
  const currentVersion = getCurrentPackageVersion();
  if (currentVersion) {
    const markerPath = getMarkerPath();
    writeFileSync(markerPath, currentVersion, "utf-8");
    return markerPath;
  }
  return null;
};

/**
 * Remove progress marker file after installation completes
 */
const cleanupProgressMarker = (): void => {
  const markerPath = getMarkerPath();
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }
};

/**
 * Display completion banners and messages
 */
const displayCompletionBanners = (): void => {
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
 * Run feature loaders for the given agent
 *
 * @param args - Configuration arguments
 * @param args.config - Configuration to use
 * @param args.agent - AI agent implementation
 */
const runFeatureLoaders = async (args: {
  config: Config;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
}): Promise<void> => {
  const { config, agent } = args;

  const registry = agent.getLoaderRegistry();
  const loaders = registry.getAll();

  info({ message: "Installing features..." });
  newline();

  for (const loader of loaders) {
    await loader.run({ config });
  }

  newline();
};

/**
 * Complete the installation by running loaders and displaying banners
 *
 * @param args - Configuration arguments
 * @param args.config - Configuration to use
 * @param args.agent - AI agent implementation
 * @param args.nonInteractive - Whether running in non-interactive mode
 * @param args.skipBuiltinProfiles - Whether to skip installing built-in profiles
 */
const completeInstallation = async (args: {
  config: Config;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
  nonInteractive: boolean;
  skipBuiltinProfiles?: boolean | null;
}): Promise<void> => {
  const { config, agent, nonInteractive, skipBuiltinProfiles } = args;

  // Pass skipBuiltinProfiles to config for loaders to access
  const configWithFlags: Config = {
    ...config,
    skipBuiltinProfiles: skipBuiltinProfiles ?? null,
  };

  // Track installation start (fire-and-forget)
  void (async () => {
    const cliParams = await buildCLIEventParams({ config });
    const userId = await getUserId({ config });
    sendAnalyticsEvent({
      eventName: "noriprof_install_started",
      eventParams: {
        ...cliParams,
        tilework_cli_non_interactive: nonInteractive,
      },
      userId,
    });
  })();

  // Create progress marker
  createProgressMarker();

  // Run feature loaders
  await runFeatureLoaders({ config: configWithFlags, agent });

  // Remove progress marker
  cleanupProgressMarker();

  // Track completion (fire-and-forget)
  void (async () => {
    const cliParams = await buildCLIEventParams({ config });
    const userId = await getUserId({ config });
    sendAnalyticsEvent({
      eventName: "noriprof_install_completed",
      eventParams: {
        ...cliParams,
        tilework_cli_non_interactive: nonInteractive,
      },
      userId,
    });
  })();

  // Display completion banners
  displayCompletionBanners();
};

/**
 * Handle cleanup of existing installation if needed
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory
 * @param args.agentImpl - AI agent implementation
 * @param args.installedAgents - List of currently installed agents
 * @param args.agentAlreadyInstalled - Whether the target agent is already installed
 */
const handleExistingInstallationCleanup = async (args: {
  skipUninstall: boolean;
  installDir: string;
  agentImpl: ReturnType<typeof AgentRegistry.prototype.get>;
  installedAgents: Array<string>;
  agentAlreadyInstalled: boolean;
}): Promise<void> => {
  const {
    skipUninstall,
    installDir,
    agentImpl,
    installedAgents,
    agentAlreadyInstalled,
  } = args;

  if (!skipUninstall && agentAlreadyInstalled) {
    const previousVersion = await getInstalledVersion({
      installDir,
    });
    info({
      message: `Cleaning up previous installation (v${previousVersion})...`,
    });

    try {
      let uninstallCmd = `nori-ai uninstall --non-interactive --install-dir="${installDir}"`;
      if (supportsAgentFlag({ version: previousVersion })) {
        uninstallCmd += ` --agent="${agentImpl.name}"`;
      }
      execSync(uninstallCmd, { stdio: "inherit" });
    } catch {
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
};

/**
 * Get information about installed agents
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.agentImpl - AI agent implementation
 *
 * @returns Object with installedAgents array and agentAlreadyInstalled boolean
 */
const getInstalledAgentInfo = async (args: {
  installDir: string;
  agentImpl: ReturnType<typeof AgentRegistry.prototype.get>;
}): Promise<{
  installedAgents: Array<string>;
  agentAlreadyInstalled: boolean;
  existingConfig: Config | null;
}> => {
  const { installDir, agentImpl } = args;

  const existingConfig = await loadConfig({ installDir });
  let installedAgents = existingConfig
    ? getInstalledAgents({ config: existingConfig })
    : [];
  const existingInstall = hasExistingInstallation({ installDir });
  if (installedAgents.length === 0 && existingInstall) {
    installedAgents = ["claude-code"];
  }
  const agentAlreadyInstalled = installedAgents.includes(agentImpl.name);

  return { installedAgents, agentAlreadyInstalled, existingConfig };
};

/**
 * Interactive installation mode
 * Delegates to init → onboard → feature loaders
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.skipBuiltinProfiles - Whether to skip installing built-in profiles
 */
export const interactive = async (args?: {
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
  skipBuiltinProfiles?: boolean | null;
}): Promise<void> => {
  const { skipUninstall, installDir, agent, skipBuiltinProfiles } = args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });
  const agentImpl = AgentRegistry.getInstance().get({
    name: agent ?? "claude-code",
  });

  // Get installed agent info
  const { installedAgents, agentAlreadyInstalled } =
    await getInstalledAgentInfo({
      installDir: normalizedInstallDir,
      agentImpl,
    });

  // Handle existing installation cleanup
  await handleExistingInstallationCleanup({
    skipUninstall: skipUninstall ?? false,
    installDir: normalizedInstallDir,
    agentImpl,
    installedAgents,
    agentAlreadyInstalled,
  });

  // Display banner
  displayNoriBanner();
  newline();
  info({ message: "Let's personalize Nori to your needs." });
  newline();

  // Step 1: Init - Set up folders and capture existing config
  await initMain({
    installDir: normalizedInstallDir,
    nonInteractive: false,
  });

  // Step 2: Onboard - Select profile and configure auth
  await onboardMain({
    installDir: normalizedInstallDir,
    nonInteractive: false,
    agent: agentImpl.name,
  });

  // Load the updated config after onboard
  const config = await loadConfig({ installDir: normalizedInstallDir });
  if (config == null) {
    error({ message: "Failed to load configuration after onboarding." });
    process.exit(1);
  }

  // Step 3: Complete installation (run loaders, track analytics, display banners)
  await completeInstallation({
    config,
    agent: agentImpl,
    nonInteractive: false,
    skipBuiltinProfiles,
  });
};

/**
 * Non-interactive installation mode
 * Delegates to init → onboard → feature loaders
 *
 * @param args - Configuration arguments
 * @param args.skipUninstall - Whether to skip uninstall step
 * @param args.installDir - Installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.profile - Profile to use (required if no existing config)
 * @param args.skipBuiltinProfiles - Whether to skip installing built-in profiles
 */
export const noninteractive = async (args?: {
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
  profile?: string | null;
  skipBuiltinProfiles?: boolean | null;
}): Promise<void> => {
  const { skipUninstall, installDir, agent, profile, skipBuiltinProfiles } =
    args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });
  const agentImpl = AgentRegistry.getInstance().get({
    name: agent ?? "claude-code",
  });

  // Get installed agent info
  const { installedAgents, agentAlreadyInstalled } =
    await getInstalledAgentInfo({
      installDir: normalizedInstallDir,
      agentImpl,
    });

  // Handle existing installation cleanup
  await handleExistingInstallationCleanup({
    skipUninstall: skipUninstall ?? false,
    installDir: normalizedInstallDir,
    agentImpl,
    installedAgents,
    agentAlreadyInstalled,
  });

  // Step 1: Init - Set up folders (non-interactive skips existing config capture)
  await initMain({
    installDir: normalizedInstallDir,
    nonInteractive: true,
  });

  // Step 2: Onboard - Set profile from flag (non-interactive requires --profile)
  await onboardMain({
    installDir: normalizedInstallDir,
    nonInteractive: true,
    profile,
    agent: agentImpl.name,
  });

  // Load the updated config after onboard
  const config = await loadConfig({ installDir: normalizedInstallDir });
  if (config == null) {
    error({ message: "Failed to load configuration after onboarding." });
    process.exit(1);
  }

  // Step 3: Complete installation (run loaders, track analytics, display banners)
  await completeInstallation({
    config,
    agent: agentImpl,
    nonInteractive: true,
    skipBuiltinProfiles,
  });
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
 * @param args.skipBuiltinProfiles - Whether to skip installing built-in profiles (for switch-profile)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  skipUninstall?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
  silent?: boolean | null;
  profile?: string | null;
  skipBuiltinProfiles?: boolean | null;
}): Promise<void> => {
  const {
    nonInteractive,
    skipUninstall,
    installDir,
    agent,
    silent,
    profile,
    skipBuiltinProfiles,
  } = args || {};

  // Save original console.log and suppress all output if silent mode requested
  const originalConsoleLog = console.log;
  if (silent) {
    setSilentMode({ silent: true });
    console.log = () => undefined;
  }

  try {
    // Silent mode implies non-interactive
    if (nonInteractive || silent) {
      await noninteractive({
        skipUninstall,
        installDir,
        agent,
        profile,
        skipBuiltinProfiles,
      });
    } else {
      await interactive({
        skipUninstall,
        installDir,
        agent,
        skipBuiltinProfiles,
      });
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
    .option(
      "--skip-builtin-profiles",
      "Skip installing built-in profiles (for switch-profile operations)",
    )
    .action(async (options) => {
      // Get global options from parent
      const globalOpts = program.opts();

      await main({
        nonInteractive: globalOpts.nonInteractive || null,
        skipUninstall: options.skipUninstall || null,
        skipBuiltinProfiles: options.skipBuiltinProfiles || null,
        installDir: globalOpts.installDir || null,
        agent: globalOpts.agent || null,
        silent: globalOpts.silent || null,
        profile: options.profile || null,
      });
    });
};
