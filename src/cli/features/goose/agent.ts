/**
 * Goose agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const gooseAgentConfig: AgentConfig = {
  name: "goose",
  displayName: "Goose",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".goose"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".goose", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".goose", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".goose", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".goose", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"], fileExtension: ".md" }),
  ],
};
