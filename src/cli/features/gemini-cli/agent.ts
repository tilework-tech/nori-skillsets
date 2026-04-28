/**
 * Gemini CLI agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { createMcpLoader } from "@/cli/features/shared/mcpLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";
import { getHomeDir } from "@/utils/home.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const geminiCliAgentConfig: AgentConfig = {
  name: "gemini-cli",
  displayName: "Gemini CLI",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".gemini"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".gemini", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".gemini", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".gemini", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".gemini", "GEMINI.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["GEMINI.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"] }),
    createMcpLoader({
      format: "gemini-json",
      projectFile: ({ installDir }) =>
        path.join(installDir, ".gemini", "settings.json"),
      projectMergeStrategy: "merge-mcp-servers-key",
      userFile: () => path.join(getHomeDir(), ".gemini", "settings.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    }),
  ],
};
