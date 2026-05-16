/**
 * Path helper functions for the Claude Code agent
 *
 * These provide paths to the user-level ~/.claude directory,
 * which is where hooks, statusline, and announcements config
 * must be written so Claude Code picks them up from any subdirectory.
 *
 * Install-directory paths (e.g. {installDir}/.claude/) are handled
 * inline in the AgentConfig in agent.ts.
 */

import * as path from "path";

import { getHomeDir } from "@/utils/home.js";

/**
 * Get the Claude home directory path (always ~/.claude)
 * This is where Claude Code always looks for user-level settings,
 * regardless of where Nori is installed.
 *
 * @returns Absolute path to ~/.claude
 */
export const getClaudeHomeDir = (): string => {
  return path.join(getHomeDir(), ".claude");
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
