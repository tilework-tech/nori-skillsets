/**
 * OpenCode agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const opencodeAgentConfig: AgentConfig = {
  name: "opencode",
  displayName: "OpenCode",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".opencode"),
  getSkillsDir: ({ installDir }) =>
    path.join(installDir, ".opencode", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".opencode", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".opencode", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".opencode", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"], fileExtension: ".md" }),
  ],
};
