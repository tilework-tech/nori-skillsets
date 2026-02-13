/**
 * Current skillset command for Nori Skillsets CLI
 * Displays the currently active skillset name
 */

import {
  loadConfig,
  getAgentProfile,
  getInstalledAgents,
} from "@/cli/config.js";
import { error, raw } from "@/cli/logger.js";

import type { ConfigAgentName } from "@/cli/config.js";

/**
 * Main function for current-skillset command
 * @param args - Configuration arguments
 * @param args.agent - Optional agent name override
 */
export const currentSkillsetMain = async (args: {
  agent?: string | null;
}): Promise<void> => {
  const { agent: agentOption } = args;

  // Load config
  const config = await loadConfig();

  if (config == null) {
    error({
      message:
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    });
    process.exit(1);
    return;
  }

  // Determine agent name
  let agentName: ConfigAgentName;
  if (agentOption != null && agentOption !== "") {
    agentName = agentOption as ConfigAgentName;
  } else {
    const installedAgents = getInstalledAgents({ config });
    agentName = (installedAgents[0] ?? "claude-code") as ConfigAgentName;
  }

  // Get profile for the agent
  const profile = getAgentProfile({ config, agentName });

  if (profile == null) {
    error({
      message:
        "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    });
    process.exit(1);
    return;
  }

  // Output the skillset name
  raw({ message: profile.baseProfile });
};
