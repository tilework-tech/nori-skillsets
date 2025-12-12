/**
 * Profile management for Nori Profiles
 * Handles profile listing, loading, and switching
 */

import { loadConfig, getAgentProfile } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { error, info } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { normalizeInstallDir } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Determine which agent to use for switch-profile command when no --agent flag provided
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

  // Load config to check installed agents
  const config = await loadConfig({ installDir });
  const installedAgents = config?.installedAgents ?? [];

  // No agents installed - default to claude-code
  if (installedAgents.length === 0) {
    return "claude-code";
  }

  // Single agent installed - use it
  if (installedAgents.length === 1) {
    return installedAgents[0];
  }

  // Multiple agents installed
  if (nonInteractive) {
    throw new Error(
      `Multiple agents installed (${installedAgents.join(", ")}). ` +
        `Please specify which agent to switch with --agent <name>.`,
    );
  }

  // Interactive mode - prompt user to select agent
  info({ message: "\nMultiple agents are installed:" });
  installedAgents.forEach((agent, index) => {
    const agentImpl = AgentRegistry.getInstance().get({ name: agent });
    info({ message: `  ${index + 1}. ${agentImpl.displayName} (${agent})` });
  });

  const selection = await promptUser({
    prompt: `Select agent to switch profile (1-${installedAgents.length}): `,
  });

  const selectedIndex = parseInt(selection, 10) - 1;
  if (
    isNaN(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= installedAgents.length
  ) {
    throw new Error("Invalid selection. Profile switch cancelled.");
  }

  return installedAgents[selectedIndex];
};

/**
 * Prompt user to confirm profile switch
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.profileName - New profile name to switch to
 * @param args.agentName - Agent name
 * @param args.nonInteractive - Whether running in non-interactive mode
 *
 * @returns True if user confirms, false otherwise
 */
const confirmSwitchProfile = async (args: {
  installDir: string;
  profileName: string;
  agentName: string;
  nonInteractive: boolean;
}): Promise<boolean> => {
  const { installDir, profileName, agentName, nonInteractive } = args;

  // Skip confirmation in non-interactive mode
  if (nonInteractive) {
    return true;
  }

  // Load config to get current profile
  const config = await loadConfig({ installDir });
  const agentProfile =
    config != null ? getAgentProfile({ config, agentName }) : null;
  const currentProfile = agentProfile?.baseProfile ?? "(none)";

  // Get agent display info
  const agent = AgentRegistry.getInstance().get({ name: agentName });

  // Display confirmation info
  info({ message: "\nSwitching profile configuration:" });
  info({ message: `  Install directory: ${installDir}` });
  info({ message: `  Agent: ${agent.displayName} (${agentName})` });
  info({ message: `  Current profile: ${currentProfile}` });
  info({ message: `  New profile: ${profileName}` });
  console.log();

  const proceed = await promptUser({
    prompt: "Proceed with profile switch? (y/n): ",
  });

  return proceed.match(/^[Yy]$/) != null;
};

/**
 * Register the 'switch-profile' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSwitchProfileCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("switch-profile <name>")
    .description("Switch to a different profile and reinstall")
    .option("-a, --agent <name>", "AI agent to switch profile for")
    .action(async (name: string, options: { agent?: string }) => {
      // Get global options from parent
      const globalOpts = program.opts();
      const installDir = normalizeInstallDir({
        installDir: globalOpts.installDir || null,
      });
      const nonInteractive = globalOpts.nonInteractive ?? false;

      // Use local --agent option if provided, otherwise auto-detect
      // We don't use globalOpts.agent because it has a default value ("claude-code")
      // which would prevent auto-detection from working
      const agentName =
        options.agent ?? (await resolveAgent({ installDir, nonInteractive }));

      const agent = AgentRegistry.getInstance().get({ name: agentName });

      // Confirm before proceeding
      const confirmed = await confirmSwitchProfile({
        installDir,
        profileName: name,
        agentName,
        nonInteractive,
      });

      if (!confirmed) {
        info({ message: "Profile switch cancelled." });
        return;
      }

      try {
        // Delegate to agent's switchProfile method
        await agent.switchProfile({ installDir, profileName: name });
      } catch (err) {
        // On failure, show available profiles
        const profiles = await agent.listProfiles({ installDir });
        if (profiles.length > 0) {
          error({ message: `Available profiles: ${profiles.join(", ")}` });
        }
        throw err;
      }

      // Run install in non-interactive mode with skipUninstall
      // This preserves custom user profiles during the profile switch
      info({ message: "Applying profile configuration..." });
      const { main: installMain } =
        await import("@/cli/commands/install/install.js");
      await installMain({
        nonInteractive: true,
        skipUninstall: true,
        installDir: globalOpts.installDir || null,
        agent: agentName,
      });
    });
};
