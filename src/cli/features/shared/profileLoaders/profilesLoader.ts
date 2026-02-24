/**
 * Shared profiles loader
 * Orchestrates profile installation for any agent via AgentConfig
 */

import * as fs from "fs/promises";

import { getActiveSkillset, type Config } from "@/cli/config.js";
import { getNoriSkillsetsDir } from "@/cli/features/paths.js";
import { installInstructionsMd } from "@/cli/features/shared/profileLoaders/instructionsMdLoader.js";
import { installSkills } from "@/cli/features/shared/profileLoaders/skillsLoader.js";
import { installSlashCommands } from "@/cli/features/shared/profileLoaders/slashCommandsLoader.js";
import { installSubagents } from "@/cli/features/shared/profileLoaders/subagentsLoader.js";
import { parseSkillset } from "@/cli/features/skillset.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

/**
 * Install profiles: create profiles directory, configure permissions,
 * parse active skillset, and run all profile sub-loaders in order.
 * @param args - Function arguments
 * @param args.agentConfig - The agent configuration
 * @param args.config - The Nori configuration
 */
export const installProfiles = async (args: {
  agentConfig: AgentConfig;
  config: Config;
}): Promise<void> => {
  const { agentConfig, config } = args;

  const noriProfilesDir = getNoriSkillsetsDir();

  // Create profiles directory if it doesn't exist
  await fs.mkdir(noriProfilesDir, { recursive: true });

  // Configure agent-specific permissions (e.g., Claude Code settings.json)
  if (agentConfig.configurePermissions != null) {
    await agentConfig.configurePermissions({
      config,
      installDir: config.installDir,
    });
  }

  // Parse the active skillset
  const skillsetName = getActiveSkillset({ config });
  if (skillsetName == null) {
    throw new Error(
      "No skillset configured. Run 'nori-skillsets init' to configure a skillset.",
    );
  }
  const skillset = await parseSkillset({
    skillsetName,
    configFileName: agentConfig.configFileName,
  });

  // Run all profile sub-loaders in order
  // Order matters: skills must be installed before instructionsMd (which reads from skills)
  await installSkills({ agentConfig, config, skillset });
  await installInstructionsMd({ agentConfig, config, skillset });
  await installSlashCommands({ agentConfig, config, skillset });
  await installSubagents({ agentConfig, config, skillset });
};
