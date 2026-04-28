/**
 * Codex agent configuration
 *
 * Codex CLI reads custom prompts from ~/.codex/prompts/ (global only — project
 * scope is "not planned" per github.com/openai/codex#9848). For project
 * installs, the prompts directory below still uses `prompts/` for cosmetic
 * accuracy, but codex won't read them.
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

const isGlobalInstall = (args: { installDir: string }): boolean => {
  const { installDir } = args;
  return path.resolve(installDir) === path.resolve(getHomeDir());
};

export const codexAgentConfig: AgentConfig = {
  name: "codex",
  displayName: "Codex",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) => path.join(installDir, ".codex"),
  getSkillsDir: ({ installDir }) => path.join(installDir, ".codex", "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, ".codex", "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, ".codex", "prompts"),
  getInstructionsFilePath: ({ installDir }) =>
    isGlobalInstall({ installDir })
      ? path.join(installDir, ".codex", "AGENTS.md")
      : path.join(installDir, "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["prompts"] }),
    createSubagentsLoader({
      managedDirs: ["agents"],
      targetFormat: "codex-toml",
    }),
    createMcpLoader({
      format: "codex-toml",
      projectFile: ({ installDir }) =>
        path.join(installDir, ".codex", "config.toml"),
      projectMergeStrategy: "merge-toml-table",
      userFile: () => path.join(getHomeDir(), ".codex", "config.toml"),
      userMergeStrategy: "merge-toml-table",
    }),
  ],
};
