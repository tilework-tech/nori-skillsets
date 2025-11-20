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
