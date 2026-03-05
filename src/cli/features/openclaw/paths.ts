/**
 * Path helper functions for the OpenClaw agent
 * Contains all path-related utilities specific to OpenClaw installation
 */

import * as path from "path";

export const getOpenclawDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".openclaw");
};

export const getOpenclawAgentsMdFile = (args: {
  installDir: string;
}): string => {
  const { installDir } = args;
  return path.join(installDir, ".openclaw", "AGENTS.md");
};

export const getOpenclawSkillsDir = (args: { installDir: string }): string => {
  return path.join(getOpenclawDir(args), "skills");
};

export const getOpenclawCommandsDir = (args: {
  installDir: string;
}): string => {
  return path.join(getOpenclawDir(args), "commands");
};

export const getOpenclawAgentsDir = (args: { installDir: string }): string => {
  return path.join(getOpenclawDir(args), "agents");
};
