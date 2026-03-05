/**
 * Path helper functions for the Pi agent
 * Contains all path-related utilities specific to Pi installation
 */

import * as path from "path";

export const getPiDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".pi");
};

export const getPiAgentsMdFile = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".pi", "AGENTS.md");
};

export const getPiSkillsDir = (args: { installDir: string }): string => {
  return path.join(getPiDir(args), "skills");
};

export const getPiCommandsDir = (args: { installDir: string }): string => {
  return path.join(getPiDir(args), "commands");
};

export const getPiAgentsDir = (args: { installDir: string }): string => {
  return path.join(getPiDir(args), "agents");
};
