/**
 * Factory Reset Command
 *
 * Removes all configuration for a given agent.
 */

import * as fs from "fs/promises";

import { log } from "@clack/prompts";

import { findArtifacts } from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { factoryResetFlow } from "@/cli/prompts/flows/factoryReset.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/**
 * Main function for factory-reset command
 *
 * @param args - Configuration arguments
 * @param args.agentName - Name of the agent to factory reset
 * @param args.path - Directory to start searching from (defaults to cwd)
 * @param args.nonInteractive - Whether running in non-interactive mode
 *
 * @returns Command status
 */
export const factoryResetMain = async (args: {
  agentName: string;
  path?: string | null;
  nonInteractive?: boolean | null;
}): Promise<CommandStatus> => {
  const { agentName, nonInteractive } = args;
  const effectivePath = args.path ?? process.cwd();

  if (nonInteractive) {
    log.error(
      "Factory reset requires explicit confirmation. Cannot proceed in non-interactive mode.",
    );
    return {
      success: false,
      cancelled: false,
      message:
        "Factory reset requires explicit confirmation. Cannot proceed in non-interactive mode",
    };
  }

  const agent = AgentRegistry.getInstance().get({ name: agentName });

  if (agent.getArtifactPatterns == null) {
    log.error(`Agent '${agentName}' does not support factory reset.`);
    return {
      success: false,
      cancelled: false,
      message: `Agent "${agentName}" does not support factory reset`,
    };
  }

  const result = await factoryResetFlow({
    agentName: agent.displayName,
    path: effectivePath,
    callbacks: {
      onFindArtifacts: async ({ path }) => {
        const artifacts = await findArtifacts({ agent, startDir: path });
        return { artifacts };
      },
      onDeleteArtifacts: async ({ artifacts }) => {
        for (const artifact of artifacts) {
          if (artifact.type === "directory") {
            await fs.rm(artifact.path, { recursive: true, force: true });
          } else {
            await fs.rm(artifact.path, { force: true });
          }
        }
      },
    },
  });

  if (result == null) {
    return { success: false, cancelled: true, message: "" };
  }

  return { success: true, cancelled: false, message: result.statusMessage };
};
