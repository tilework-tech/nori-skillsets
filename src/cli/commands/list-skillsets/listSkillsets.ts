/**
 * List skillsets command for Nori Skillsets CLI
 * Lists locally available skillsets for programmatic use
 */

import { loadConfig, getInstalledAgents } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { listProfiles } from "@/cli/features/managedFolder.js";
import { error, raw } from "@/cli/logger.js";
import { normalizeInstallDir, getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Main function for list-skillsets command
 * @param args - Configuration arguments
 * @param args.installDir - Optional custom installation directory
 * @param args.agent - Optional agent name override
 */
export const listSkillsetsMain = async (args: {
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { agent: agentOption } = args;

  // Determine installation directory
  let installDir: string;

  if (args.installDir != null && args.installDir !== "") {
    installDir = normalizeInstallDir({ installDir: args.installDir });
  } else {
    const installations = getInstallDirs({ currentDir: process.cwd() });
    if (installations.length === 0) {
      error({
        message:
          "No Nori installation found in current directory or ancestors.",
      });
      process.exit(1);
    }
    installDir = installations[0];
  }

  // Determine which agent to use
  let agentName: string;

  if (agentOption != null && agentOption !== "") {
    agentName = agentOption;
  } else {
    // Auto-detect from config
    const config = await loadConfig({ installDir });
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
    error({
      message: `Unknown agent '${agentName}'. Available: ${availableAgents}`,
    });
    process.exit(1);
    return;
  }

  // Get and output profiles - one per line for easy parsing
  const profiles = await listProfiles({ installDir });

  if (profiles.length === 0) {
    error({
      message: `No skillsets installed for ${agent.displayName} at ${installDir}.`,
    });
    process.exit(1);
  }

  for (const profile of profiles) {
    raw({ message: profile });
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
        installDir: globalOpts.installDir || null,
        agent: globalOpts.agent || null,
      });
    });
};
