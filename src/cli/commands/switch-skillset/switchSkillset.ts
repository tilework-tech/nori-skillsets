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
import { listSkillsets } from "@/cli/features/managedFolder.js";
import { setSilentMode, isSilentMode } from "@/cli/logger.js";
import { switchSkillsetFlow } from "@/cli/prompts/flows/switchSkillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

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
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });

  // Interactive flow
  if (!nonInteractive) {
    await switchSkillsetFlow({
      skillsetName: name,
      installDir,
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
        onPrepareSwitchInfo: async ({
          installDir: dir,
          agentName: agentName,
        }) => {
          const agent = AgentRegistry.getInstance().get({ name: agentName });
          const localChanges = await agent.detectLocalChanges({
            installDir: dir,
          });
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
          const config: Config = {
            installDir: dir,
            activeSkillset: pName,
          };
          // Capture existing config for all default agents that support it
          for (const captureAgentName of captureAgentNames) {
            const captureAgent = AgentRegistry.getInstance().get({
              name: captureAgentName,
            });
            await captureAgent.captureExistingConfig?.({
              installDir: dir,
              skillsetName: pName,
              config,
            });
          }
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

  // Check for local changes before proceeding (check first agent's manifest)
  const firstAgentName = agentNames[0];
  const firstAgent = AgentRegistry.getInstance().get({ name: firstAgentName });
  const localChanges = await firstAgent.detectLocalChanges({
    installDir,
  });

  if (localChanges != null && !force) {
    throw new Error(
      `Local changes detected in installed skillset files. ` +
        `Cannot proceed in non-interactive mode. ` +
        `Modified: ${localChanges.modified.length}, Added: ${localChanges.added.length}, Deleted: ${localChanges.deleted.length}. ` +
        `Run interactively to choose how to handle these changes, or use --force to discard them.`,
    );
  }

  // Broadcast switch to all configured agents
  for (const agentName of agentNames) {
    const agent = AgentRegistry.getInstance().get({ name: agentName });

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
  }
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
