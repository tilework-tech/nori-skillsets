/**
 * Cursor agent configuration
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

/**
 * Data-oriented Cursor agent configuration
 */
export const cursorAgentConfig: AgentConfig = {
  name: "cursor-agent",
  displayName: "Cursor",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".cursor"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".cursor", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".cursor", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".cursor", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".cursor", "rules", "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedDirs: ["rules"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"] }),
    createMcpLoader({
      format: "cursor-json",
      projectFile: ({ installDir }) =>
        path.join(installDir, ".cursor", "mcp.json"),
      projectMergeStrategy: "merge-mcp-servers-key",
      userFile: () => path.join(getHomeDir(), ".cursor", "mcp.json"),
      userMergeStrategy: "merge-mcp-servers-key",
    }),
  ],
};
