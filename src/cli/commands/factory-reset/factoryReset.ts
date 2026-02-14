/**
 * Factory Reset Command
 *
 * Removes all configuration for a given agent.
 */

import * as fs from "fs/promises";

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { findClaudeCodeArtifacts } from "@/cli/features/claude-code/factoryReset.js";
import { error } from "@/cli/logger.js";
import { factoryResetFlow } from "@/cli/prompts/flows/factoryReset.js";

/**
 * Main function for factory-reset command
 *
 * @param args - Configuration arguments
 * @param args.agentName - Name of the agent to factory reset
 * @param args.path - Directory to start searching from (defaults to cwd)
 * @param args.nonInteractive - Whether running in non-interactive mode
 * @param args.experimentalUi - Whether to use the experimental clack-based UI
 */
export const factoryResetMain = async (args: {
  agentName: string;
  path?: string | null;
  nonInteractive?: boolean | null;
  experimentalUi?: boolean | null;
}): Promise<void> => {
  const { agentName, nonInteractive, experimentalUi } = args;
  const effectivePath = args.path ?? process.cwd();

  if (nonInteractive) {
    error({
      message:
        "Factory reset requires explicit confirmation. Cannot proceed in non-interactive mode.",
    });
    process.exit(1);
    return;
  }

  const agent = AgentRegistry.getInstance().get({ name: agentName });

  if (agent.factoryReset == null) {
    error({
      message: `Agent '${agentName}' does not support factory reset.`,
    });
    process.exit(1);
    return;
  }

  // Experimental UI flow (interactive only)
  if (experimentalUi) {
    await factoryResetFlow({
      agentName: agent.displayName,
      path: effectivePath,
      callbacks: {
        onFindArtifacts: async ({ path }) => {
          const artifacts = await findClaudeCodeArtifacts({ startDir: path });
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
    return;
  }

  await agent.factoryReset({ path: effectivePath });
};
