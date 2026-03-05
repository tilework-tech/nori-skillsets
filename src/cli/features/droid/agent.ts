/**
 * Droid (Factory) agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const droidAgentConfig: AgentConfig = {
  name: "droid",
  displayName: "Droid",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".factory"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".factory", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".factory", "droids"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".factory", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".factory", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["droids"] }),
  ],
};
