/**
 * Kimi CLI agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const kimiCliAgentConfig: AgentConfig = {
  name: "kimi-cli",
  displayName: "Kimi CLI",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".kimi"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".kimi", "skills"),
  getSubagentsDir: ({ installDir }) => path.join(installDir, ".kimi", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".kimi", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".kimi", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"] }),
  ],
};
