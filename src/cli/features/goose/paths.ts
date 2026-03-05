/**
 * Path helper functions for the Goose agent
 * Contains all path-related utilities specific to Goose installation
 */

import * as path from "path";

export const getGooseDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".goose");
};

export const getGooseAgentsMdFile = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".goose", "AGENTS.md");
};

export const getGooseSkillsDir = (args: { installDir: string }): string => {
  return path.join(getGooseDir(args), "skills");
};

export const getGooseCommandsDir = (args: { installDir: string }): string => {
  return path.join(getGooseDir(args), "commands");
};

export const getGooseAgentsDir = (args: { installDir: string }): string => {
  return path.join(getGooseDir(args), "agents");
};
