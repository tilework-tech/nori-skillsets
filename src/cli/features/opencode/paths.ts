/**
 * Path helper functions for the OpenCode agent
 * Contains all path-related utilities specific to OpenCode installation
 */

import * as path from "path";

export const getOpencodeDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".opencode");
};

export const getOpencodeAgentsMdFile = (args: {
  installDir: string;
}): string => {
  const { installDir } = args;
  return path.join(installDir, ".opencode", "AGENTS.md");
};

export const getOpencodeSkillsDir = (args: { installDir: string }): string => {
  return path.join(getOpencodeDir(args), "skills");
};

export const getOpencodeCommandsDir = (args: {
  installDir: string;
}): string => {
  return path.join(getOpencodeDir(args), "commands");
};

export const getOpencodeAgentsDir = (args: { installDir: string }): string => {
  return path.join(getOpencodeDir(args), "agents");
};
