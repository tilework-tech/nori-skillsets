/**
 * Environment paths and constants for installer
 * Centralized location for Claude-related paths
 */

import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

/**
 * MCP root directory (where package.json is located)
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const MCP_ROOT = path.resolve(__dirname, "../../..");

/**
 * Get the Claude directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the .claude directory
 */
export const getClaudeDir = (args: { installDir: string }): string => {
  const { installDir } = args;
  return path.join(installDir, ".claude");
};

/**
 * Get the Claude settings file path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to settings.json
 */
export const getClaudeSettingsFile = (args: { installDir: string }): string => {
  return path.join(getClaudeDir(args), "settings.json");
};

/**
 * Get the Claude agents directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the agents directory
 */
export const getClaudeAgentsDir = (args: { installDir: string }): string => {
  return path.join(getClaudeDir(args), "agents");
};

/**
 * Get the Claude commands directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the commands directory
 */
export const getClaudeCommandsDir = (args: { installDir: string }): string => {
  return path.join(getClaudeDir(args), "commands");
};

/**
 * Get the CLAUDE.md file path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to CLAUDE.md
 */
export const getClaudeMdFile = (args: { installDir: string }): string => {
  return path.join(getClaudeDir(args), "CLAUDE.md");
};

/**
 * Get the Claude skills directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the skills directory
 */
export const getClaudeSkillsDir = (args: { installDir: string }): string => {
  return path.join(getClaudeDir(args), "skills");
};

/**
 * Get the Claude profiles directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the profiles directory
 */
export const getClaudeProfilesDir = (args: { installDir: string }): string => {
  return path.join(getClaudeDir(args), "profiles");
};

/**
 * Get the Claude home directory path (always ~/.claude)
 * This is where Claude Code always looks for user-level settings,
 * regardless of where Nori is installed.
 *
 * @returns Absolute path to ~/.claude
 */
export const getClaudeHomeDir = (): string => {
  return path.join(os.homedir(), ".claude");
};

/**
 * Get the Claude home settings file path (always ~/.claude/settings.json)
 * This is where hooks and statusline configuration should be written
 * to ensure Claude Code picks them up from any subdirectory.
 *
 * @returns Absolute path to ~/.claude/settings.json
 */
export const getClaudeHomeSettingsFile = (): string => {
  return path.join(getClaudeHomeDir(), "settings.json");
};

// Cursor environment paths

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
 * Get the Cursor settings file path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to settings.json
 */
export const getCursorSettingsFile = (args: { installDir: string }): string => {
  return path.join(getCursorDir(args), "settings.json");
};

/**
 * Get the Cursor profiles directory path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to the profiles directory
 */
export const getCursorProfilesDir = (args: { installDir: string }): string => {
  return path.join(getCursorDir(args), "profiles");
};

/**
 * Get the Cursor home directory path (always ~/.cursor)
 * This is where Cursor stores user-level configuration.
 *
 * @returns Absolute path to ~/.cursor
 */
export const getCursorHomeDir = (): string => {
  return path.join(os.homedir(), ".cursor");
};

/**
 * Get the Cursor home settings file path (always ~/.cursor/settings.json)
 *
 * @returns Absolute path to ~/.cursor/settings.json
 */
export const getCursorHomeSettingsFile = (): string => {
  return path.join(getCursorHomeDir(), "settings.json");
};

/**
 * Get the Cursor hooks file path
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns Absolute path to hooks.json
 */
export const getCursorHooksFile = (args: { installDir: string }): string => {
  return path.join(getCursorDir(args), "hooks.json");
};

/**
 * Get the Cursor home hooks file path (always ~/.cursor/hooks.json)
 *
 * @returns Absolute path to ~/.cursor/hooks.json
 */
export const getCursorHomeHooksFile = (): string => {
  return path.join(getCursorHomeDir(), "hooks.json");
};
