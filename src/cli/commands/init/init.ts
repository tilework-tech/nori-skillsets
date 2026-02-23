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

import { log } from "@clack/prompts";

import {
  loadConfig,
  updateConfig,
  getDefaultAgents,
  type Config,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { initFlow } from "@/cli/prompts/flows/init.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { normalizeInstallDir } from "@/utils/path.js";

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
  const normalizedInstallDir = normalizeInstallDir({
    installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });

  // Resolve all default agents for agent-specific operations
  const existingConfigForAgent = await loadConfig();
  const defaultAgentNames = getDefaultAgents({
    config: existingConfigForAgent,
  });
  const defaultAgent = AgentRegistry.getInstance().get({
    name: defaultAgentNames[0],
  });

  // Interactive flow
  if (!nonInteractive) {
    await initFlow({
      installDir: normalizedInstallDir,
      skipWarning: skipWarning ?? null,
      callbacks: {
        onCheckAncestors: async () => {
          return [];
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
          // Capture existing config for all default agents that support it
          for (const agentName of defaultAgentNames) {
            const agent = AgentRegistry.getInstance().get({
              name: agentName,
            });
            await agent.captureExistingConfig?.({
              installDir: dir,
              skillsetName,
              config,
            });
          }
        },
        onInit: async ({ installDir: dir, capturedSkillsetName }) => {
          // Create ~/.nori/profiles/ directory
          const skillsetsDir = getNoriSkillsetsDir();
          if (!(await directoryExists(skillsetsDir))) {
            await fs.mkdir(skillsetsDir, { recursive: true });
          }

          const existingConfig = await loadConfig();
          const currentVersion = getCurrentPackageVersion();

          const activeSkillset =
            capturedSkillsetName ?? existingConfig?.activeSkillset ?? null;

          await updateConfig({
            activeSkillset,
            version: currentVersion ?? null,
          });

          // Mark this directory as having all default agents installed
          for (const agentName of defaultAgentNames) {
            const agent = AgentRegistry.getInstance().get({
              name: agentName,
            });
            agent.markInstall({
              path: dir,
              skillsetName: capturedSkillsetName,
            });
          }
        },
      },
    });
    return;
  }

  // Non-interactive path

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

  // Set activeSkillset - if a skillset was captured, set it as the active skillset
  const activeSkillset =
    capturedSkillsetName ?? existingConfig?.activeSkillset ?? null;

  // Save config — do not persist installDir; only `sks config` should change it.
  await updateConfig({
    activeSkillset,
    version: currentVersion ?? null,
  });

  // If a skillset was captured, capture config and install managed block for all agents
  if (capturedSkillsetName != null) {
    const config: Config = {
      installDir: normalizedInstallDir,
      activeSkillset,
    };
    for (const agentName of defaultAgentNames) {
      const agent = AgentRegistry.getInstance().get({ name: agentName });
      await agent.captureExistingConfig?.({
        installDir: normalizedInstallDir,
        skillsetName: capturedSkillsetName,
        config,
      });
    }
    log.success(`Configuration saved as skillset "${capturedSkillsetName}"`);
  }

  // Mark this directory as having all default agents installed
  for (const agentName of defaultAgentNames) {
    const agent = AgentRegistry.getInstance().get({ name: agentName });
    agent.markInstall({
      path: normalizedInstallDir,
      skillsetName: capturedSkillsetName,
    });
  }
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
