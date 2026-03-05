/**
 * GitHub Copilot agent configuration
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const githubCopilotAgentConfig: AgentConfig = {
  name: "github-copilot",
  displayName: "GitHub Copilot",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".github"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".github", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".github", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".github", "prompts"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".github", "copilot-instructions.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["copilot-instructions.md"] }),
    createSlashCommandsLoader({ managedDirs: ["prompts"] }),
    createSubagentsLoader({ managedDirs: ["agents"] }),
  ],

  getArtifactPatterns: () => ({
    dirs: [".github"],
    files: ["copilot-instructions.md"],
  }),
};
