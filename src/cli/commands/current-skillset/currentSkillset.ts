/**
 * Current skillset command for Nori Skillsets CLI
 * Displays the currently active skillset name
 */

import { log } from "@clack/prompts";

import { loadConfig, getActiveSkillset } from "@/cli/config.js";

/**
 * Main function for current-skillset command
 * @param _args - Command arguments
 * @param _args.agent - Optional agent name (unused, kept for CLI compatibility)
 */
export const currentSkillsetMain = async (_args: {
  agent?: string | null;
}): Promise<void> => {
  // Load config from home directory (centralized config location)
  const config = await loadConfig();

  if (config == null) {
    log.error(
      "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    );
    process.exit(1);
    return;
  }

  const skillset = getActiveSkillset({ config });

  if (skillset == null) {
    log.error(
      "No active skillset configured. Use 'nori-skillsets switch <name>' to set one.",
    );
    process.exit(1);
    return;
  }

  // Output the skillset name (plain stdout for scripting use)
  process.stdout.write(skillset + "\n");
};
