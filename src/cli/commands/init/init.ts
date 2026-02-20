/**
 * Init Command
 *
 * Initializes Nori configuration and directories.
 * This is the first step in the installation process.
 *
 * Responsibilities:
 * - Create .nori-config.json with minimal structure
 * - Create ~/.nori/profiles/ directory
 * - Detect and capture existing Claude Code configuration as a skillset
 * - Warn about ancestor installations
 */

import * as fs from "fs/promises";

import { log, note } from "@clack/prompts";

import {
  loadConfig,
  saveConfig,
  getDefaultAgents,
  type Config,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getNoriSkillsetsDir } from "@/cli/features/claude-code/paths.js";
import { bold, yellow } from "@/cli/logger.js";
import { initFlow } from "@/cli/prompts/flows/init.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Check if a directory exists
 *
 * @param dirPath - Path to the directory to check
 *
 * @returns True if the directory exists, false otherwise
 */
const directoryExists = async (dirPath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Main init function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.skipWarning - Whether to skip the skillset persistence warning (useful for auto-init in download flows)
 */
export const initMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  skipWarning?: boolean | null;
}): Promise<void> => {
  const { installDir, nonInteractive, skipWarning } = args ?? {};
  const normalizedInstallDir = normalizeInstallDir({ installDir });

  // Resolve the default agent for all agent-specific operations
  const existingConfigForAgent = await loadConfig();
  const defaultAgentName = getDefaultAgents({
    config: existingConfigForAgent,
  })[0];
  const defaultAgent = AgentRegistry.getInstance().get({
    name: defaultAgentName,
  });

  // Interactive flow
  if (!nonInteractive) {
    await initFlow({
      installDir: normalizedInstallDir,
      skipWarning: skipWarning ?? null,
      callbacks: {
        onCheckAncestors: async ({ installDir: dir }) => {
          const allInstallations = getInstallDirs({
            currentDir: dir,
          });
          return allInstallations.filter((installPath) => installPath !== dir);
        },
        onDetectExistingConfig: async ({ installDir: dir }) => {
          const existingConfig = await loadConfig();
          if (existingConfig != null) return null;
          // Skip detection if default agent is already installed at this location
          if (defaultAgent.isInstalledAtDir({ path: dir })) return null;
          return (
            (await defaultAgent.detectExistingConfig?.({ installDir: dir })) ??
            null
          );
        },
        onCaptureConfig: async ({ installDir: dir, skillsetName }) => {
          // Build a config object for the agent to use when restoring managed config
          const config: Config = {
            installDir: dir,
            activeSkillset: skillsetName,
          };
          await defaultAgent.captureExistingConfig?.({
            installDir: dir,
            skillsetName,
            config,
          });
        },
        onInit: async ({ installDir: dir, capturedSkillsetName }) => {
          // Create ~/.nori/profiles/ directory
          const skillsetsDir = getNoriSkillsetsDir();
          if (!(await directoryExists(skillsetsDir))) {
            await fs.mkdir(skillsetsDir, { recursive: true });
          }

          const existingConfig = await loadConfig();
          const currentVersion = getCurrentPackageVersion();

          const username = existingConfig?.auth?.username ?? null;
          const password = existingConfig?.auth?.password ?? null;
          const refreshToken = existingConfig?.auth?.refreshToken ?? null;
          const organizationUrl = existingConfig?.auth?.organizationUrl ?? null;
          const sendSessionTranscript =
            existingConfig?.sendSessionTranscript ?? null;
          const autoupdate = existingConfig?.autoupdate ?? null;
          const version = currentVersion ?? null;

          const activeSkillset =
            capturedSkillsetName ?? existingConfig?.activeSkillset ?? null;

          await saveConfig({
            username,
            password,
            refreshToken,
            organizationUrl,
            sendSessionTranscript,
            autoupdate,
            activeSkillset,
            version,
            installDir: dir,
          });

          // Mark this directory as having the default agent installed
          defaultAgent.markInstall({
            path: dir,
            skillsetName: capturedSkillsetName,
          });
        },
      },
    });
    return;
  }

  // Non-interactive path

  // Check for ancestor managed installations (warn only)
  const ancestorManagedInstallations = getInstallDirs({
    currentDir: normalizedInstallDir,
  }).filter((installPath) => installPath !== normalizedInstallDir);

  if (ancestorManagedInstallations.length > 0) {
    const warningLines = [
      yellow({ text: "Nested Nori managed installations detected" }),
      "",
      "Claude Code loads CLAUDE.md files from all parent directories.",
      "Having multiple managed installations can cause duplicate or",
      "conflicting configurations.",
      "",
      bold({ text: "Existing managed installations:" }),
      ...ancestorManagedInstallations.map((a) => `  • ${a}`),
      "",
      "Please remove the conflicting installation before continuing.",
    ];
    note(warningLines.join("\n"), "Warning");
  }

  // Create ~/.nori/profiles/ directory
  const skillsetsDir = getNoriSkillsetsDir();
  if (!(await directoryExists(skillsetsDir))) {
    await fs.mkdir(skillsetsDir, { recursive: true });
  }

  // Load existing config (if any)
  const existingConfig = await loadConfig();
  const currentVersion = getCurrentPackageVersion();

  // Track captured skillset name for setting in config
  let capturedSkillsetName: string | null = null;

  // If no existing config and default agent not already installed, check for existing configuration to capture
  if (
    existingConfig == null &&
    !defaultAgent.isInstalledAtDir({ path: normalizedInstallDir })
  ) {
    const detectedConfig = await defaultAgent.detectExistingConfig?.({
      installDir: normalizedInstallDir,
    });
    if (detectedConfig != null) {
      capturedSkillsetName = "my-profile";
    }
  }

  // Create or update config
  const username = existingConfig?.auth?.username ?? null;
  const password = existingConfig?.auth?.password ?? null;
  const refreshToken = existingConfig?.auth?.refreshToken ?? null;
  const organizationUrl = existingConfig?.auth?.organizationUrl ?? null;
  const organizations = existingConfig?.auth?.organizations ?? null;
  const isAdmin = existingConfig?.auth?.isAdmin ?? null;
  const sendSessionTranscript = existingConfig?.sendSessionTranscript ?? null;
  const autoupdate = existingConfig?.autoupdate ?? null;
  const transcriptDestination = existingConfig?.transcriptDestination ?? null;
  const version = currentVersion ?? null;

  // Set activeSkillset - if a skillset was captured, set it as the active skillset
  const activeSkillset =
    capturedSkillsetName ?? existingConfig?.activeSkillset ?? null;

  // Save config
  await saveConfig({
    username,
    password,
    refreshToken,
    organizationUrl,
    organizations,
    isAdmin,
    sendSessionTranscript,
    autoupdate,
    activeSkillset,
    version,
    transcriptDestination,
    installDir: normalizedInstallDir,
  });

  // If a skillset was captured, capture config and install managed block
  if (capturedSkillsetName != null) {
    const config: Config = {
      installDir: normalizedInstallDir,
      activeSkillset,
    };
    await defaultAgent.captureExistingConfig?.({
      installDir: normalizedInstallDir,
      skillsetName: capturedSkillsetName,
      config,
    });
    log.success(`Configuration saved as skillset "${capturedSkillsetName}"`);
  }

  // Mark this directory as having the default agent installed
  defaultAgent.markInstall({
    path: normalizedInstallDir,
    skillsetName: capturedSkillsetName,
  });
};

/**
 * Register the 'init' command with commander
 *
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerInitCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("init")
    .description("Initialize Nori configuration and directories")
    .action(async () => {
      // Get global options from parent
      const globalOpts = program.opts();

      await initMain({
        installDir: globalOpts.installDir || null,
        nonInteractive: globalOpts.nonInteractive || null,
      });
    });
};
