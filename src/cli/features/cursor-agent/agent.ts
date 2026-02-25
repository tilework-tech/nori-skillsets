/**
 * Cursor agent configuration
 * Pure data struct — all behavior lives in shared handler functions
 */

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

export const cursorConfig: AgentConfig = {
  name: "cursor-agent",
  displayName: "Cursor",
  description: "Instructions, skills, subagents, commands",

  agentDirName: ".cursor",
  instructionFilePath: "rules/AGENTS.md",
  configFileName: "CLAUDE.md",
  skillsPath: "skills",
  slashcommandsPath: "commands",
  subagentsPath: "agents",

  extraManagedDirs: ["rules"],
};
