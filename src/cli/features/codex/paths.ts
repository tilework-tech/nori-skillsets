/**
 * Path helper functions for the Codex agent
 * Contains all path-related utilities specific to Codex installation
 */

import * as path from "path";

export const getCodexDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".codex");
};

export const getCodexAgentsMdFile = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".codex", "AGENTS.md");
};

export const getCodexSkillsDir = (args: { installDir: string }): string => {
  return path.join(getCodexDir(args), "skills");
};

export const getCodexCommandsDir = (args: { installDir: string }): string => {
  return path.join(getCodexDir(args), "commands");
};

export const getCodexAgentsDir = (args: { installDir: string }): string => {
  return path.join(getCodexDir(args), "agents");
};
