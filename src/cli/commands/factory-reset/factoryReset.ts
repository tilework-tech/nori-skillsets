/**
 * Factory Reset Command
 *
 * Removes all configuration for a given agent.
 */

import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { error } from "@/cli/logger.js";

/**
 * Main function for factory-reset command
 *
 * @param args - Configuration arguments
 * @param args.agentName - Name of the agent to factory reset
 * @param args.path - Directory to start searching from (defaults to cwd)
 * @param args.nonInteractive - Whether running in non-interactive mode
 */
export const factoryResetMain = async (args: {
  agentName: string;
  path?: string | null;
  nonInteractive?: boolean | null;
}): Promise<void> => {
  const { agentName, nonInteractive } = args;
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

  await agent.factoryReset({ path: effectivePath });
};
