/**
 * Path helpers for cursor-agent
 * All cursor-specific paths are defined here
 */

import * as os from "os";
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
 * Get the hooks.json file path for Cursor
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the hooks.json file
 */
export const getCursorHooksFile = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(getCursorDir({ installDir }), "hooks.json");
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

/**
 * Get the subagents directory path for Cursor
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Path to the subagents directory
 */
export const getCursorSubagentsDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(getCursorDir({ installDir }), "subagents");
};

/**
 * Get the Cursor home directory path (always ~/.cursor)
 * This is where Cursor looks for user-level settings,
 * regardless of where Nori is installed.
 *
 * @returns Absolute path to ~/.cursor
 */
export const getCursorHomeDir = (): string => {
  return path.join(os.homedir(), ".cursor");
};

/**
 * Get the Cursor home hooks file path (always ~/.cursor/hooks.json)
 * This is where hooks configuration should be written
 * to ensure Cursor picks them up from any subdirectory.
 *
 * @returns Absolute path to ~/.cursor/hooks.json
 */
export const getCursorHomeHooksFile = (): string => {
  return path.join(getCursorHomeDir(), "hooks.json");
};

/**
 * Get the Cursor home commands directory path (always ~/.cursor/commands)
 * This is where global slash commands should be installed
 * to ensure Cursor picks them up from any subdirectory.
 *
 * @returns Absolute path to ~/.cursor/commands
 */
export const getCursorHomeCommandsDir = (): string => {
  return path.join(getCursorHomeDir(), "commands");
};
