/**
 * Path helper functions for the Cursor agent
 * Contains all path-related utilities specific to Cursor installation
 */

import * as path from "path";

/**
 * Get the Cursor directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the .cursor directory
 */
export const getCursorDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".cursor");
};

/**
 * Get the AGENTS.md file path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to AGENTS.md
 */
export const getCursorAgentsMdFile = (args: { installDir: string }): string => {
  return path.join(getCursorDir(args), "AGENTS.md");
};

/**
 * Get the Cursor skills directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the skills directory
 */
export const getCursorSkillsDir = (args: { installDir: string }): string => {
  return path.join(getCursorDir(args), "skills");
};

/**
 * Get the Cursor commands directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the commands directory
 */
export const getCursorCommandsDir = (args: { installDir: string }): string => {
  return path.join(getCursorDir(args), "commands");
};

/**
 * Get the Cursor agents directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the agents directory
 */
export const getCursorAgentsDir = (args: { installDir: string }): string => {
  return path.join(getCursorDir(args), "agents");
};
