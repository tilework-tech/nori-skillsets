/**
 * Path utilities for watch command
 *
 * Handles path conversions for Claude Code session directories
 * and transcript storage locations.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Get the home directory, reading from environment for test compatibility
 *
 * @returns Home directory path
 */
const getHomeDir = (): string => {
  // Use process.env.HOME if set (for tests), otherwise os.homedir()
  return process.env.HOME ?? os.homedir();
};

/**
 * Get the Claude Code projects directory
 *
 * @returns Path to ~/.claude/projects
 */
export const getClaudeProjectsDir = (): string => {
  return path.join(getHomeDir(), ".claude", "projects");
};

/**
 * Convert a working directory path to Claude's project directory name format
 *
 * Claude Code uses a specific naming convention: replace all non-alphanumeric
 * characters (except dash) with dashes. This matches the algorithm in:
 * https://github.com/specstoryai/getspecstory/blob/main/specstory-cli/pkg/providers/claudecode/path_utils.go
 *
 * @param args - Configuration arguments
 * @param args.cwd - Current working directory to convert
 *
 * @returns Project directory name (e.g., "-Users-sean-Projects-app")
 */
export const getClaudeProjectDir = (args: { cwd: string }): string => {
  const { cwd } = args;

  // Resolve symlinks to match Claude Code's behavior
  let resolvedPath: string;
  try {
    resolvedPath = fs.realpathSync(cwd);
  } catch {
    // If path doesn't exist, use it as-is
    resolvedPath = cwd;
  }

  // Replace anything that's not alphanumeric or dash with a dash
  let projectDirName = resolvedPath.replace(/[^a-zA-Z0-9-]/g, "-");

  // Ensure leading dash if not already there
  if (!projectDirName.startsWith("-")) {
    projectDirName = "-" + projectDirName;
  }

  return projectDirName;
};

/**
 * Get the transcript directory for a given agent and project
 *
 * @param args - Configuration arguments
 * @param args.agent - Agent name (e.g., "claude-code")
 * @param args.projectName - Project directory name
 *
 * @returns Path to transcript directory
 */
export const getTranscriptDir = (args: {
  agent: string;
  projectName: string;
}): string => {
  const { agent, projectName } = args;
  return path.join(getHomeDir(), ".nori", "transcripts", agent, projectName);
};

/**
 * Get the PID file path for the watch daemon
 *
 * @returns Path to ~/.nori/watch.pid
 */
export const getWatchPidFile = (): string => {
  return path.join(getHomeDir(), ".nori", "watch.pid");
};

/**
 * Get the log file path for the watch daemon
 *
 * @returns Path to ~/.nori/logs/watch.log
 */
export const getWatchLogFile = (): string => {
  return path.join(getHomeDir(), ".nori", "logs", "watch.log");
};

/**
 * Get the transcript registry database path
 *
 * @returns Path to ~/.nori/transcripts/registry.db
 */
export const getTranscriptRegistryPath = (): string => {
  return path.join(getHomeDir(), ".nori", "transcripts", "registry.db");
};
