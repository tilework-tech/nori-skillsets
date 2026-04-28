/**
 * Goose agent configuration
 *
 * Goose's canonical global config dir is ~/.config/goose/. It has no
 * project-level config dir; project-level instructions live as AGENTS.md
 * (or .goosehints) at the project root. See:
 * https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/using-goosehints.md
 */

import * as path from "path";

import { configLoader } from "@/cli/features/configLoader.js";
import { createInstructionsLoader } from "@/cli/features/shared/instructionsLoader.js";
import { skillsLoader } from "@/cli/features/shared/skillsLoader.js";
import { createSlashCommandsLoader } from "@/cli/features/shared/slashCommandsLoader.js";
import { createSubagentsLoader } from "@/cli/features/shared/subagentsLoader.js";
import { getHomeDir } from "@/utils/home.js";

import type { AgentConfig } from "@/cli/features/agentRegistry.js";

const GLOBAL_GOOSE_DIR = path.join(".config", "goose");
const PROJECT_GOOSE_DIR = ".goose";

const isGlobalInstall = (args: { installDir: string }): boolean => {
  const { installDir } = args;
  return path.resolve(installDir) === path.resolve(getHomeDir());
};

const gooseDirSegment = (args: { installDir: string }): string =>
  isGlobalInstall(args) ? GLOBAL_GOOSE_DIR : PROJECT_GOOSE_DIR;

export const gooseAgentConfig: AgentConfig = {
  name: "goose",
  displayName: "Goose",
  description: "Instructions, skills, subagents, commands",

  getAgentDir: ({ installDir }) =>
    path.join(installDir, gooseDirSegment({ installDir })),
  getSkillsDir: ({ installDir }) =>
    path.join(installDir, gooseDirSegment({ installDir }), "skills"),
  getSubagentsDir: ({ installDir }) =>
    path.join(installDir, gooseDirSegment({ installDir }), "agents"),
  getSlashcommandsDir: ({ installDir }) =>
    path.join(installDir, gooseDirSegment({ installDir }), "commands"),
  getInstructionsFilePath: ({ installDir }) =>
    isGlobalInstall({ installDir })
      ? path.join(installDir, GLOBAL_GOOSE_DIR, "AGENTS.md")
      : path.join(installDir, "AGENTS.md"),

  getLoaders: () => [
    configLoader,
    skillsLoader,
    createInstructionsLoader({ managedFiles: ["AGENTS.md"] }),
    createSlashCommandsLoader({ managedDirs: ["commands"] }),
    createSubagentsLoader({ managedDirs: ["agents"] }),
  ],
};
