/**
 * Clear skillset command for Nori Skillsets
 * Removes the current skillset entirely, giving the user a clean agent configuration
 */

import { runUninstall } from "@/cli/commands/uninstall/uninstall.js";
import {
  loadConfig,
  getAgentProfile,
  getInstalledAgents,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { info, success, newline } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Determine which agent to use when no --agent flag provided
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether running in non-interactive mode
 *
 * @throws Error if in non-interactive mode with multiple agents installed
 *
 * @returns The agent name to use
 */
const resolveAgent = async (args: {
  installDir: string;
  nonInteractive: boolean;
}): Promise<string> => {
  const { installDir, nonInteractive } = args;

  const config = await loadConfig({ installDir });
  const installedAgents = config ? getInstalledAgents({ config }) : [];

  if (installedAgents.length === 0) {
    return "claude-code";
  }

  if (installedAgents.length === 1) {
    return installedAgents[0];
  }

  if (nonInteractive) {
    throw new Error(
      `Multiple agents installed (${installedAgents.join(", ")}). ` +
        `Please specify which agent to clear with --agent <name>.`,
    );
  }

  info({ message: "\nMultiple agents are installed:" });
  installedAgents.forEach((agent, index) => {
    const agentImpl = AgentRegistry.getInstance().get({ name: agent });
    info({ message: `  ${index + 1}. ${agentImpl.displayName} (${agent})` });
  });

  const selection = await promptUser({
    prompt: `Select agent to clear skillset (1-${installedAgents.length}): `,
  });

  const selectedIndex = parseInt(selection, 10) - 1;
  if (
    isNaN(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= installedAgents.length
  ) {
    throw new Error("Invalid selection. Clear skillset cancelled.");
  }

  return installedAgents[selectedIndex];
};

/**
 * Prompt user to confirm clearing the skillset
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.agentName - Agent name
 * @param args.nonInteractive - Whether running in non-interactive mode
 *
 * @returns True if user confirms, false otherwise
 */
const confirmClearSkillset = async (args: {
  installDir: string;
  agentName: string;
  nonInteractive: boolean;
}): Promise<boolean> => {
  const { installDir, agentName, nonInteractive } = args;

  if (nonInteractive) {
    return true;
  }

  const config = await loadConfig({ installDir });
  const agentProfile =
    config != null ? getAgentProfile({ config, agentName }) : null;
  const currentProfile = agentProfile?.baseProfile ?? "(none)";

  const agent = AgentRegistry.getInstance().get({ name: agentName });

  info({ message: "\nClearing skillset configuration:" });
  info({ message: `  Install directory: ${installDir}` });
  info({ message: `  Agent: ${agent.displayName} (${agentName})` });
  info({ message: `  Current skillset: ${currentProfile}` });
  newline();

  const proceed = await promptUser({
    prompt: "Proceed with clearing skillset? (y/n): ",
  });

  return proceed.match(/^[Yy]$/) != null;
};

/**
 * Main entry point for clear-skillset command
 * Clears the agent's profile and runs uninstall to remove profile artifacts
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory (optional, auto-detected if not provided)
 * @param args.nonInteractive - Whether to run without prompts
 * @param args.agent - Agent name (optional, auto-detected if not provided)
 */
export const clearSkillsetMain = async (args: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  agent?: string | null;
}): Promise<void> => {
  const { nonInteractive: nonInteractiveArg, agent: agentArg } = args;
  const nonInteractive = nonInteractiveArg ?? false;

  // Determine installation directory
  let installDir: string;

  if (args.installDir != null && args.installDir !== "") {
    installDir = normalizeInstallDir({ installDir: args.installDir });
  } else {
    const installations = getInstallDirs({ currentDir: process.cwd() });
    if (installations.length === 0) {
      throw new Error(
        "No Nori installations found in current directory or parent directories. " +
          "Run 'nori-ai install' to create a new installation, or use --install-dir to specify a location.",
      );
    }
    installDir = installations[0];
  }

  const agentName =
    agentArg ?? (await resolveAgent({ installDir, nonInteractive }));

  const agent = AgentRegistry.getInstance().get({ name: agentName });

  // Confirm before proceeding
  const confirmed = await confirmClearSkillset({
    installDir,
    agentName,
    nonInteractive,
  });

  if (!confirmed) {
    info({ message: "Clear skillset cancelled." });
    return;
  }

  // Clear the profile in config
  await agent.clearProfile({ installDir });

  // Run uninstall to remove profile artifacts (skills, CLAUDE.md managed block, etc.)
  // Preserve config and global settings (hooks, statusline, global slash commands)
  await runUninstall({
    removeConfig: false,
    removeGlobalSettings: false,
    installDir,
    agent: agentName,
  });

  newline();
  success({ message: `Skillset cleared for ${agent.displayName}` });
  info({
    message: "Restart your agent to apply the changes.",
  });
};

/**
 * Register the 'clear-skillset' command with commander (for nori-ai CLI)
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerClearSkillsetCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("clear-skillset")
    .description(
      "Remove the current skillset and reset to a clean configuration",
    )
    .option("-a, --agent <name>", "AI agent to clear skillset for")
    .action(async (options: { agent?: string }) => {
      const globalOpts = program.opts();

      await clearSkillsetMain({
        installDir: globalOpts.installDir || null,
        nonInteractive: globalOpts.nonInteractive || null,
        agent: options.agent ?? null,
      });
    });
};
