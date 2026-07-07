/**
 * List agents command for Nori Skillsets CLI
 * Prints every valid agent identifier registered in the CLI as a single
 * comma-separated line, for programmatic consumption — e.g. validating an
 * agent name before `sks switch -a <agent>` / `sks config --agents <list>`.
 */

import { AgentRegistry } from "@/cli/features/agentRegistry.js";

/**
 * Return every registered agent identifier, in registration order.
 *
 * This mirrors exactly what `switch` and `config` accept (both resolve agent
 * names through the same registry), so a consumer can treat it as the
 * authoritative "is this agent valid" oracle. Includes experimental-tier
 * agents, since those are also accepted by `switch`/`config`.
 *
 * @returns Every registered agent identifier, in registration order
 */
export const getRegisteredAgents = (): Array<string> =>
  AgentRegistry.getInstance().list();

/**
 * Main function for the list-agents command.
 * Writes the agent ids as a comma-separated line for easy parsing.
 */
export const listAgentsMain = (): void => {
  process.stdout.write(getRegisteredAgents().join(",") + "\n");
};
