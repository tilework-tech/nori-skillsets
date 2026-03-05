/**
 * Path helper functions for the GitHub Copilot agent
 * Contains all path-related utilities specific to GitHub Copilot installation
 */

import * as path from "path";

export const getGithubDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".github");
};

export const getGithubCopilotInstructionsFile = (args: {
  installDir: string;
}): string => {
  const { installDir } = args;
  return path.join(installDir, ".github", "copilot-instructions.md");
};

export const getGithubSkillsDir = (args: { installDir: string }): string => {
  return path.join(getGithubDir(args), "skills");
};

export const getGithubPromptsDir = (args: { installDir: string }): string => {
  return path.join(getGithubDir(args), "prompts");
};

export const getGithubAgentsDir = (args: { installDir: string }): string => {
  return path.join(getGithubDir(args), "agents");
};
