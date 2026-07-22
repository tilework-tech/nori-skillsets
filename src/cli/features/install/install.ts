#!/usr/bin/env node

/**
 * Nori Skillsets Installer
 *
 * Orchestrates the installation process:
 * 1. init - Set up folders and capture existing config
 * 2. Resolve skillset and save to config
 * 3. Run feature loaders, write manifest, display banners
 */

import { writeFileSync, unlinkSync, existsSync } from "fs";
import * as path from "path";

import { log, note } from "@clack/prompts";

import {
  loadConfig,
  updateConfig,
  getActiveSkillset,
  type Config,
} from "@/cli/config.js";
import {
  installSkillset,
  markInstall,
} from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import {
  displayWelcomeBanner,
  displaySeaweedBed,
} from "@/cli/features/install/asciiArt.js";
import { ensureNoriInitialized } from "@/cli/features/install/initialize.js";
import {
  buildCLIEventParams,
  getUserId,
  sendAnalyticsEvent,
} from "@/cli/installTracking.js";
import { isSilentMode, setSilentMode } from "@/cli/logger.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { getHomeDir } from "@/utils/home.js";
import { normalizeInstallDir } from "@/utils/path.js";

/**
 * Get the path for the progress marker file
 * @returns The absolute path to the progress marker file
 */
const getMarkerPath = (): string => {
  return path.join(getHomeDir(), ".nori-install-in-progress");
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
  if (isSilentMode()) return;
  displayWelcomeBanner();
  note(
    "Restart your Claude Code instances to get started",
    "Installation Complete",
  );
  displaySeaweedBed();
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

  createProgressMarker();
  try {
    await installSkillset({
      agent,
      config,
    });
  } finally {
    cleanupProgressMarker();
  }

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
 * Runs init, resolves skillset and saves config, then runs feature loaders
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.skillset - Skillset to use (required if no existing config)
 * @param args.persistActiveSkillset - When false, do not persist the selected skillset to the global config (transient --install-dir switch)
 * @param args.silent - Whether to suppress all output
 */
type NoninteractiveArgs = {
  installDir?: string | null;
  agent?: string | null;
  skillset?: string | null;
  persistActiveSkillset?: boolean | null;
  silent?: boolean | null;
};

const noninteractiveImpl = async (args?: NoninteractiveArgs): Promise<void> => {
  const { installDir, agent, skillset, persistActiveSkillset } = args || {};
  const normalizedInstallDir = normalizeInstallDir({
    installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });
  const agentImpl = AgentRegistry.getInstance().get({
    name: agent ?? AgentRegistry.getInstance().getDefaultAgentName(),
  });

  // Step 1: Init - Set up folders (non-interactive skips existing config capture)
  await ensureNoriInitialized({
    installDir: normalizedInstallDir,
    skillset,
    markInstalled: false,
  });

  // Step 2: Resolve skillset and save to config
  const existingConfig = await loadConfig();
  if (existingConfig == null) {
    log.error(
      "No Nori configuration found. Please run 'nori-skillsets init' first.",
    );
    process.exit(1);
  }

  const existingSkillset = getActiveSkillset({ config: existingConfig });

  if (skillset == null && existingSkillset == null) {
    log.error(
      "Non-interactive install requires a skillset when no existing skillset is set",
    );
    note("nori-skillsets install <skillset-name>", "Example");
    process.exit(1);
  }

  const selectedSkillset = skillset ?? existingSkillset!;

  // Persist the active skillset to the global config unless this is a transient
  // install — e.g. a per-worktree switch that passed an explicit --install-dir
  // override. Transient switches install into their own directory and must not
  // clobber the user's global active skillset.
  if (persistActiveSkillset !== false) {
    await updateConfig({
      activeSkillset: selectedSkillset,
    });
  }

  // Reload config after saving
  const config = await loadConfig();
  if (config == null) {
    log.error("Failed to load configuration after setup.");
    process.exit(1);
  }

  // Step 3: Complete installation (run loaders, track analytics, display banners)
  // Use the runtime installDir for operational purposes (where to write files),
  // not the persisted one. Only `sks config` should change persisted installDir.
  // When persistence was skipped (a transient --install-dir switch), `config`
  // still holds the old global activeSkillset, so overlay the selected one in
  // memory for this install only — and thread `persistActiveSkillset: false`
  // so configLoader (which otherwise writes `config.activeSkillset` to disk)
  // keeps the global value. On the persisted path `config.activeSkillset`
  // already holds the canonical selected skillset, so leave it untouched.
  await completeInstallation({
    config: {
      ...config,
      installDir: normalizedInstallDir,
      ...(persistActiveSkillset === false
        ? {
            activeSkillset: selectedSkillset,
            persistActiveSkillset: false,
          }
        : {}),
    },
    agent: agentImpl,
    nonInteractive: true,
  });
  markInstall({
    agent: agentImpl,
    path: normalizedInstallDir,
    skillsetName: selectedSkillset,
  });
};

export const noninteractive = async (
  args?: NoninteractiveArgs,
): Promise<void> => {
  const silent = args?.silent === true;
  const wasSilent = isSilentMode();
  const originalConsoleLog = console.log;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  if (silent) {
    setSilentMode({ silent: true });
    console.log = () => undefined;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
  }

  try {
    await noninteractiveImpl(args);
  } finally {
    if (silent) {
      console.log = originalConsoleLog;
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      setSilentMode({ silent: wasSilent });
    }
  }
};

/**
 * Main installer entry point
 * @param args - Configuration arguments
 * @param args.nonInteractive - Whether to run in non-interactive mode (kept for caller compatibility)
 * @param args.installDir - Custom installation directory (optional)
 * @param args.agent - AI agent to use (defaults to claude-code)
 * @param args.silent - Whether to suppress all output
 * @param args.skillset - Skillset to use (required if no existing config)
 * @param args.persistActiveSkillset - When false, do not persist the selected skillset to the global config (transient --install-dir switch)
 */
export const main = async (args?: {
  nonInteractive?: boolean | null;
  installDir?: string | null;
  agent?: string | null;
  silent?: boolean | null;
  skillset?: string | null;
  persistActiveSkillset?: boolean | null;
}): Promise<void> => {
  const { installDir, agent, silent, skillset, persistActiveSkillset } =
    args || {};

  try {
    await noninteractive({
      installDir,
      agent,
      skillset,
      persistActiveSkillset,
      silent,
    });
  } catch (err: any) {
    if (silent !== true) log.error(err.message);
    process.exit(1);
  }
};
