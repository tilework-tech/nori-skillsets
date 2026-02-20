/**
 * Skillset management for Nori Skillsets
 * Handles skillset listing, loading, and switching
 */

import { log } from "@clack/prompts";

import {
  loadConfig,
  getActiveSkillset,
  getDefaultAgents,
  type Config,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getClaudeDir } from "@/cli/features/claude-code/paths.js";
import {
  readManifest,
  compareManifest,
  hasChanges,
  getManifestPath,
  type ManifestDiff,
} from "@/cli/features/claude-code/skillsets/manifest.js";
import { listSkillsets } from "@/cli/features/managedFolder.js";
import { setSilentMode, isSilentMode } from "@/cli/logger.js";
import { switchSkillsetFlow } from "@/cli/prompts/flows/switchSkillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Detect local changes to installed files
 *
 * Compares the current state of ~/.claude/ against the stored manifest
 * to detect any user modifications.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Manifest diff if changes detected, null otherwise
 */
const detectLocalChanges = async (args: {
  installDir: string;
}): Promise<ManifestDiff | null> => {
  const { installDir } = args;

  const manifestPath = getManifestPath();
  const manifest = await readManifest({ manifestPath });

  // No manifest means first install or manual setup - no changes detectable
  if (manifest == null) {
    return null;
  }

  const claudeDir = getClaudeDir({ installDir });
  const diff = await compareManifest({ manifest, currentDir: claudeDir });

  return hasChanges(diff) ? diff : null;
};

/**
 * Shared action handler for switch-skillset commands
 * @param args - Configuration arguments
 * @param args.name - The skillset name to switch to
 * @param args.options - Command options
 * @param args.options.agent - Optional agent name override
 * @param args.program - Commander program instance
 * @param args.options.force - Whether to force through local changes without prompting
 */
export const switchSkillsetAction = async (args: {
  name: string;
  options: { agent?: string; force?: boolean };
  program: Command;
}): Promise<void> => {
  const { name, options, program } = args;

  // Get global options from parent
  const globalOpts = program.opts();
  const nonInteractive = globalOpts.nonInteractive ?? false;
  const force = options.force ?? false;

  // Determine installation directory: CLI flag > config > home dir
  const config = await loadConfig();
  const installDir = resolveInstallDir({
    cliInstallDir: globalOpts.installDir,
    config,
  });

  // Interactive flow
  if (!nonInteractive) {
    await switchSkillsetFlow({
      skillsetName: name,
      installDir,
      agentOverride: options.agent ?? null,
      callbacks: {
        onResolveAgents: async () => {
          const config = await loadConfig();
          const agentNames = getDefaultAgents({ config });
          return agentNames.map((agentName) => {
            const agent = AgentRegistry.getInstance().get({
              name: agentName,
            });
            return { name: agentName, displayName: agent.displayName };
          });
        },
        onPrepareSwitchInfo: async ({ installDir: dir }) => {
          const localChanges = await detectLocalChanges({ installDir: dir });
          const config = await loadConfig();
          const currentProfile =
            config != null ? getActiveSkillset({ config }) : null;
          return { currentProfile, localChanges };
        },
        onCaptureConfig: async ({ installDir: dir, skillsetName: pName }) => {
          const captureConfig = await loadConfig();
          const captureAgentNames = getDefaultAgents({
            config: captureConfig,
          });
          const captureAgent = AgentRegistry.getInstance().get({
            name: captureAgentNames[0],
          });
          const config: Config = {
            installDir: dir,
            activeSkillset: pName,
          };
          await captureAgent.captureExistingConfig?.({
            installDir: dir,
            skillsetName: pName,
            config,
          });
        },
        onExecuteSwitch: async ({
          installDir: dir,
          agentName,
          skillsetName: pName,
        }) => {
          const agent = AgentRegistry.getInstance().get({ name: agentName });
          const wasSilent = isSilentMode();
          setSilentMode({ silent: true });
          try {
            await agent.switchSkillset({
              installDir: dir,
              skillsetName: pName,
            });
          } catch (err) {
            setSilentMode({ silent: wasSilent });
            const profiles = await listSkillsets();
            if (profiles.length > 0) {
              log.error(`Available skillsets: ${profiles.join(", ")}`);
            }
            throw err;
          }
          setSilentMode({ silent: wasSilent });
          const { main: installMain } =
            await import("@/cli/commands/install/install.js");
          await installMain({
            nonInteractive: true,
            installDir: dir,
            agent: agentName,
            silent: true,
          });
        },
      },
    });

    // Flow handles all UI (cancel messages, success notes) internally.
    // result is null on cancel, non-null on success — either way we're done.
    return;
  }

  // Non-interactive flow
  const nonInteractiveConfig = await loadConfig();
  const agentNames = getDefaultAgents({
    config: nonInteractiveConfig,
    agentOverride: options.agent,
  });
  const agentName = agentNames[0];
  const agent = AgentRegistry.getInstance().get({ name: agentName });

  // Check for local changes before proceeding
  const localChanges = await detectLocalChanges({ installDir });

  if (localChanges != null && !force) {
    throw new Error(
      `Local changes detected in installed skillset files. ` +
        `Cannot proceed in non-interactive mode. ` +
        `Modified: ${localChanges.modified.length}, Added: ${localChanges.added.length}, Deleted: ${localChanges.deleted.length}. ` +
        `Run interactively to choose how to handle these changes, or use --force to discard them.`,
    );
  }

  try {
    // Delegate to agent's switchSkillset method
    await agent.switchSkillset({ installDir, skillsetName: name });
  } catch (err) {
    // On failure, show available skillsets
    const profiles = await listSkillsets();
    if (profiles.length > 0) {
      log.error(`Available skillsets: ${profiles.join(", ")}`);
    }
    throw err;
  }

  // Run install in silent mode to regenerate files with new skillset
  const { main: installMain } =
    await import("@/cli/commands/install/install.js");
  await installMain({
    nonInteractive: true,
    installDir,
    agent: agentName,
    silent: true,
  });
};

/**
 * Register the 'switch-skillset' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSwitchSkillsetCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("switch-skillset <name>")
    .description("Switch to a different skillset and reinstall")
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .option("--force", "Force switch even when local changes are detected")
    .action(
      async (name: string, options: { agent?: string; force?: boolean }) => {
        await switchSkillsetAction({ name, options, program });
      },
    );
};
