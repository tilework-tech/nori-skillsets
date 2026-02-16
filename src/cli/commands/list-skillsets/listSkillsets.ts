/**
 * List skillsets command for Nori Skillsets CLI
 * Lists locally available skillsets for programmatic use
 */

import * as os from "os";

import { log } from "@clack/prompts";

import { loadConfig, getInstalledAgents } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { listProfiles } from "@/cli/features/managedFolder.js";

import type { Command } from "commander";

/**
 * Main function for list-skillsets command
 * @param args - Configuration arguments
 * @param args.agent - Optional agent name override
 */
export const listSkillsetsMain = async (args: {
  agent?: string | null;
}): Promise<void> => {
  const { agent: agentOption } = args;

  // Determine which agent to use
  let agentName: string;

  if (agentOption != null && agentOption !== "") {
    agentName = agentOption;
  } else {
    // Auto-detect from config - use home directory since agent config is global
    const config = await loadConfig({ startDir: os.homedir() });
    const installedAgents = config ? getInstalledAgents({ config }) : [];

    if (installedAgents.length === 0) {
      agentName = "claude-code";
    } else {
      agentName = installedAgents[0];
    }
  }

  // Validate agent exists
  let agent;
  try {
    agent = AgentRegistry.getInstance().get({ name: agentName });
  } catch {
    const availableAgents = AgentRegistry.getInstance().list().join(", ");
    log.error(`Unknown agent '${agentName}'. Available: ${availableAgents}`);
    process.exit(1);
    return;
  }

  // Get and output profiles - one per line for easy parsing
  // Profiles are always loaded from ~/.nori/profiles/
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    log.error(`No skillsets installed for ${agent.displayName}.`);
    process.exit(1);
  }

  // Output raw lines for scripting
  for (const profile of profiles) {
    process.stdout.write(profile + "\n");
  }
};

/**
 * Register the 'list-skillsets' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerListSkillsetsCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("list-skillsets")
    .description("List locally available skillsets (one per line)")
    .action(async () => {
      const globalOpts = program.opts();
      await listSkillsetsMain({
        agent: globalOpts.agent || null,
      });
    });
};
