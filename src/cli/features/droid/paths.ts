/**
 * Path helper functions for the Droid (Factory) agent
 * Contains all path-related utilities specific to Droid installation
 */

import * as path from "path";

export const getFactoryDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".factory");
};

export const getFactoryAgentsMdFile = (args: {
  installDir: string;
}): string => {
  const { installDir } = args;
  return path.join(installDir, ".factory", "AGENTS.md");
};

export const getFactorySkillsDir = (args: { installDir: string }): string => {
  return path.join(getFactoryDir(args), "skills");
};

export const getFactoryCommandsDir = (args: { installDir: string }): string => {
  return path.join(getFactoryDir(args), "commands");
};

export const getFactoryDroidsDir = (args: { installDir: string }): string => {
  return path.join(getFactoryDir(args), "droids");
};
