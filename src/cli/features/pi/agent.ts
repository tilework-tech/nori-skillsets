/**
 * Pi agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const piAgentConfig: AgentConfig = {
  name: "pi",
  displayName: "Pi",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".pi"),
  getSkillsDir: ({ installDir }) =>
    path.join(installDir, ".pi", "agent", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".pi", "agent", "subagents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".pi", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".pi", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({
      managedDirs: ["agents"],
      targetFormat: "pi-markdown",
    }),
  ],
};
