/**
 * Claude Code agent configuration
 */

import * as path from "path";

import { announcementsLoader } from "@/cli/features/claude-code/announcements/loader.js";
import { hooksLoader } from "@/cli/features/claude-code/hooks/loader.js";
import { statuslineLoader } from "@/cli/features/claude-code/statusline/loader.js";
import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";
import { getHomeDir } from "@/utils/home.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

/**
 * Data-oriented Claude Code agent configuration
 */
export const claudeCodeAgentConfig: AgentConfig = {
  name: "claude-code",
  displayName: "Claude Code",
  description:
    "Instructions, skills, subagents, commands, hooks, statusline, watch",

  getAgentDir: ({ installDir }) => path.join(installDir, ".claude"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".claude", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".claude", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".claude", "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    path.join(installDir, ".claude", "CLAUDE.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["CLAUDE.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"], fileExtension: ".md" }),
    hooksLoader,
    statuslineLoader,
    announcementsLoader,
  ],

  getTranscriptDirectory: () => path.join(getHomeDir(), ".claude", "projects"),
  getArtifactPatterns: () => ({
    dirs: [".claude"],
    files: ["CLAUDE.md"],
  }),
};
