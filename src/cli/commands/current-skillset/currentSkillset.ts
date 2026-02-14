/**
 * Current skillset command for Nori Skillsets CLI
 * Displays the currently active skillset name
 */

import * as os from "os";

import { log } from "@clack/prompts";

import {
  loadConfig,
  getAgentProfile,
  getInstalledAgents,
} from "@/cli/config.js";

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

  // Load config from home directory (centralized config location)
  const config = await loadConfig({ startDir: os.homedir() });

  if (config == null) {
    log.error(
      "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    );
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
    log.error(
      "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    );
    process.exit(1);
    return;
  }

  // Output the skillset name (plain stdout for scripting use)
  process.stdout.write(profile.baseProfile + "\n");
};
