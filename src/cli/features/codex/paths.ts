/**
 * Path helper functions for the Codex agent
 * Contains all path-related utilities specific to Codex installation
 */

import * as path from "path";

/**
 * Get the Codex directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the .codex directory
 */
export const getCodexDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".codex");
};

/**
 * Get the Codex instructions file path (AGENTS.md)
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to AGENTS.md
 */
export const getCodexInstructionsFile = (args: {
  installDir: string;
}): string => {
  return path.join(getCodexDir(args), "AGENTS.md");
};

/**
 * Get the Codex skills directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the skills directory
 */
export const getCodexSkillsDir = (args: { installDir: string }): string => {
  return path.join(getCodexDir(args), "skills");
};

/**
 * Get the Codex agents directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the agents directory
 */
export const getCodexAgentsDir = (args: { installDir: string }): string => {
  return path.join(getCodexDir(args), "agents");
};

/**
 * Get the Codex commands directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the commands directory
 */
export const getCodexCommandsDir = (args: { installDir: string }): string => {
  return path.join(getCodexDir(args), "commands");
};
