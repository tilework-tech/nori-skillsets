/**
 * Path helper functions for the Kimi CLI agent
 * Contains all path-related utilities specific to Kimi CLI installation
 */

import * as path from "path";

export const getKimiDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".kimi");
};

export const getKimiAgentsMdFile = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".kimi", "AGENTS.md");
};

export const getKimiSkillsDir = (args: { installDir: string }): string => {
  return path.join(getKimiDir(args), "skills");
};

export const getKimiCommandsDir = (args: { installDir: string }): string => {
  return path.join(getKimiDir(args), "commands");
};

export const getKimiAgentsDir = (args: { installDir: string }): string => {
  return path.join(getKimiDir(args), "agents");
};
