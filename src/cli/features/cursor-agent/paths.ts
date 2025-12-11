/**
 * Path helpers for cursor-agent
 * All cursor-specific paths are defined here
 */

import * as path from "path";

/**
 * Get the .cursor directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the .cursor directory
 */
export const getCursorDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  // Normalize to remove trailing slash
  const normalized = installDir.endsWith("/")
    ? installDir.slice(0, -1)
    : installDir;
  return path.join(normalized, ".cursor");
};

/**
 * Get the profiles directory path for Cursor
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the profiles directory
 */
export const getCursorProfilesDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(getCursorDir({ installDir }), "profiles");
};

/**
 * Get the rules directory path for Cursor
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the rules directory
 */
export const getCursorRulesDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(getCursorDir({ installDir }), "rules");
};

/**
 * Get the AGENTS.md file path for Cursor
 * AGENTS.md is placed at the project root per the AGENTS.md specification
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the AGENTS.md file
 */
export const getCursorAgentsMdFile = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, "AGENTS.md");
};

/**
 * Get the commands directory path for Cursor
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the commands directory
 */
export const getCursorCommandsDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(getCursorDir({ installDir }), "commands");
};
