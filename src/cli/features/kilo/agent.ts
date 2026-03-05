/**
 * Kilo Code agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const kiloAgentConfig: AgentConfig = {
  name: "kilo",
  displayName: "Kilo Code",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".kilocode"),
  getSkillsDir: ({ installDir }) =>
    path.join(installDir, ".kilocode", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".kilocode", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".kilocode", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".kilocode", "rules", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedDirs: ["rules"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"] }),
  ],

  getArtifactPatterns: () => ({
    dirs: [".kilocode"],
    files: [],
  }),
};
