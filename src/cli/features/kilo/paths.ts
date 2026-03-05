/**
 * Path helper functions for the Kilo Code agent
 * Contains all path-related utilities specific to Kilo Code installation
 */

import * as path from "path";

export const getKilocodeDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".kilocode");
};

export const getKilocodeAgentsMdFile = (args: {
  installDir: string;
}): string => {
  const { installDir } = args;
  return path.join(installDir, ".kilocode", "rules", "AGENTS.md");
};

export const getKilocodeSkillsDir = (args: { installDir: string }): string => {
  return path.join(getKilocodeDir(args), "skills");
};

export const getKilocodeCommandsDir = (args: {
  installDir: string;
}): string => {
  return path.join(getKilocodeDir(args), "commands");
};

export const getKilocodeAgentsDir = (args: { installDir: string }): string => {
  return path.join(getKilocodeDir(args), "agents");
};
