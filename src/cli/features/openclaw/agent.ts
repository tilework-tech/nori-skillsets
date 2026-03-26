/**
 * OpenClaw agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const openclawAgentConfig: AgentConfig = {
  name: "openclaw",
  displayName: "OpenClaw",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".openclaw"),
  getSkillsDir: ({ installDir }) =>
    path.join(installDir, ".openclaw", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".openclaw", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".openclaw", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".openclaw", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"], fileExtension: ".md" }),
  ],
};
