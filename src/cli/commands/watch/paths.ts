/**
 * Path utilities for watch command
 *
 * Handles path conversions for session directories
 * and transcript storage locations.
 */

import * as path from "path";

import { getHomeDir } from "@/utils/home.js";

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
