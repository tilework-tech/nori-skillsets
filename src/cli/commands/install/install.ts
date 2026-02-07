#!/usr/bin/env node

/**
 * Nori Profiles Installer
 *
 * Orchestrates the installation process:
 * 1. init - Set up folders and capture existing config
 * 2. Resolve profile and save to config
 * 3. Run feature loaders, write manifest, display banners
 */

import { writeFileSync, unlinkSync, existsSync } from "fs";
import * as os from "os";
import * as path from "path";

import { initMain } from "@/cli/commands/init/init.js";
import {
  displayWelcomeBanner,
  displaySeaweedBed,
} from "@/cli/commands/install/asciiArt.js";
import {
  loadConfig,
  saveConfig,
  getAgentProfile,
  type Config,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getClaudeDir } from "@/cli/features/claude-code/paths.js";
import {
  computeDirectoryManifest,
  writeManifest,
  getManifestPath,
} from "@/cli/features/claude-code/profiles/manifest.js";
import {
  buildCLIEventParams,
  getUserId,
  sendAnalyticsEvent,
} from "@/cli/installTracking.js";
import { error, success, info, newline, setSilentMode } from "@/cli/logger.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

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
 * Write manifest of installed files for change detection
 *
 * Creates a manifest file containing hashes of all files installed to ~/.claude/
 * This is used by switch-skillset to detect local modifications.
 *
 * @param args - Configuration arguments
 * @param args.config - Configuration to use
 * @param args.agentName - Name of the agent being installed
 */
const writeInstalledManifest = async (args: {
  config: Config;
  agentName: string;
}): Promise<void> => {
  const { config, agentName } = args;

  // Only write manifest for claude-code agent
  if (agentName !== "claude-code") {
    return;
  }

  const profileName = getAgentProfile({ config, agentName })?.baseProfile;
  if (profileName == null) {
    return;
  }

  const claudeDir = getClaudeDir({ installDir: config.installDir });
  const manifestPath = getManifestPath();

  try {
    const manifest = await computeDirectoryManifest({
      dir: claudeDir,
      profileName,
    });
    await writeManifest({ manifestPath, manifest });
    info({ message: "✓ Created installation manifest for change detection" });
  } catch {
    // Non-fatal - manifest writing failure shouldn't block installation
  }
};

/**
 * Complete the installation by running loaders and displaying banners
 *
 * @param args - Configuration arguments
 * @param args.config - Configuration to use
 * @param args.agent - AI agent implementation
 * @param args.nonInteractive - Whether running in non-interactive mode
 */
const completeInstallation = async (args: {
  config: Config;
  agent: ReturnType<typeof AgentRegistry.prototype.get>;
  nonInteractive: boolean;
}): Promise<void> => {
  const { config, agent, nonInteractive } = args;

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
  await runFeatureLoaders({ config, agent });

  // Write manifest for change detection
  await writeInstalledManifest({ config, agentName: agent.name });

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
 * Non-interactive installation mode
 * Runs init, resolves profile and saves config, then runs feature loaders
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.profile - Profile to use (required if no existing config)
 */
export const noninteractive = async (args?: {
  installDir?: string | null;
  agent?: string | null;
  profile?: string | null;
}): Promise<void> => {
  const { installDir, agent, profile } = args || {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });
  const agentImpl = AgentRegistry.getInstance().get({
    name: agent ?? "claude-code",
  });

  // Step 1: Init - Set up folders (non-interactive skips existing config capture)
  await initMain({
    installDir: normalizedInstallDir,
    nonInteractive: true,
  });

  // Step 2: Resolve profile and save to config
  const existingConfig = await loadConfig();
  if (existingConfig == null) {
    error({
      message:
        "No Nori configuration found. Please run 'nori-skillsets init' first.",
    });
    process.exit(1);
  }

  const existingProfile = getAgentProfile({
    config: existingConfig,
    agentName: agentImpl.name,
  });

  if (profile == null && existingProfile == null) {
    error({
      message:
        "Non-interactive install requires --profile flag when no existing profile is set",
    });
    info({
      message:
        "Example: nori-skillsets install --non-interactive --profile <profile-name>",
    });
    process.exit(1);
  }

  const selectedProfile = profile ? { baseProfile: profile } : existingProfile!;

  const agents = {
    ...(existingConfig.agents ?? {}),
    [agentImpl.name]: { profile: selectedProfile },
  };

  await saveConfig({
    username: existingConfig.auth?.username ?? null,
    password: existingConfig.auth?.password ?? null,
    refreshToken: existingConfig.auth?.refreshToken ?? null,
    organizationUrl: existingConfig.auth?.organizationUrl ?? null,
    sendSessionTranscript: existingConfig.sendSessionTranscript ?? null,
    autoupdate: existingConfig.autoupdate ?? null,
    agents,
    version: existingConfig.version ?? null,
    installDir: normalizedInstallDir,
  });

  // Reload config after saving
  const config = await loadConfig();
  if (config == null) {
    error({ message: "Failed to load configuration after setup." });
    process.exit(1);
  }

  // Step 3: Complete installation (run loaders, track analytics, display banners)
  await completeInstallation({
    config,
    agent: agentImpl,
    nonInteractive: true,
  });
};

/**
 * Main installer entry point
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode (kept for caller compatibility)
 * @param args.installDir - Custom installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.silent - Whether to suppress all output
 * @param args.profile - Profile to use (required if no existing config)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
  silent?: boolean | null;
  profile?: string | null;
}): Promise<void> => {
  const { installDir, agent, silent, profile } = args || {};

  // Save original console.log and suppress all output if silent mode requested
  const originalConsoleLog = console.log;
  if (silent) {
    setSilentMode({ silent: true });
    console.log = () => undefined;
  }

  try {
    await noninteractive({
      installDir,
      agent,
      profile,
    });
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
