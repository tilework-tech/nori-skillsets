/**
 * Path helper functions for the Claude Code agent
 * Contains all path-related utilities specific to Claude Code installation
 */

import * as os from "os";
import * as path from "path";

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

/**
 * Get the Claude home commands directory path (always ~/.claude/commands)
 * This is where slash commands are installed so Claude Code
 * picks them up from any subdirectory.
 *
 * @returns Absolute path to ~/.claude/commands
 */
export const getClaudeHomeCommandsDir = (): string => {
  return path.join(getClaudeHomeDir(), "commands");
};

/**
 * Get the Nori directory path
 * Always returns ~/.nori (centralized location)
 *
 * @returns Absolute path to the .nori directory
 */
export const getNoriDir = (): string => {
  return path.join(os.homedir(), ".nori");
};

/**
 * Get the Nori profiles directory path
 * This is where all profile templates are stored
 *
 * @returns Absolute path to the profiles directory
 */
export const getNoriProfilesDir = (): string => {
  return path.join(getNoriDir(), "profiles");
};
