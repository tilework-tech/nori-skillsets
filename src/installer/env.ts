/**
 * Environment paths and constants for installer
 * Centralized location for Claude-related paths
 */

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
