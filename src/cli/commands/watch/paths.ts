/**
 * Path utilities for watch command
 *
 * Locations of the watch daemon's PID and log files.
 */

import * as path from "path";

import { getHomeDir } from "@/utils/home.js";

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
