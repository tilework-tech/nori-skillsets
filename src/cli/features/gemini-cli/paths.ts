/**
 * Path helper functions for the Gemini CLI agent
 * Contains all path-related utilities specific to Gemini CLI installation
 */

import * as path from "path";

export const getGeminiDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".gemini");
};

export const getGeminiMdFile = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".gemini", "GEMINI.md");
};

export const getGeminiSkillsDir = (args: { installDir: string }): string => {
  return path.join(getGeminiDir(args), "skills");
};

export const getGeminiCommandsDir = (args: { installDir: string }): string => {
  return path.join(getGeminiDir(args), "commands");
};

export const getGeminiAgentsDir = (args: { installDir: string }): string => {
  return path.join(getGeminiDir(args), "agents");
};
