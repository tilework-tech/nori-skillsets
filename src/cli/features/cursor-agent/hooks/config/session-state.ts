/**
 * Session state tracking for run-once hooks
 * Tracks whether this is the first prompt in a session per working directory
 */

import { createHash } from "crypto";
import * as fs from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";

/**
 * Get the session marker file path for a given cwd
 * Uses a hash of the cwd to create a unique marker file per directory
 *
 * @param args - Arguments
 * @param args.cwd - Current working directory
 *
 * @returns Path to the session marker file
 */
export const getSessionMarkerPath = (args: { cwd: string }): string => {
  const { cwd } = args;

  // Create a hash of the cwd for the marker filename
  const cwdHash = createHash("md5").update(cwd).digest("hex").substring(0, 8);
  const markerFilename = `nori-cursor-session-${cwdHash}`;

  return path.join(tmpdir(), markerFilename);
};

/**
 * Check if this is the first prompt in the session for the given cwd
 *
 * @param args - Arguments
 * @param args.cwd - Current working directory
 *
 * @returns True if this is the first prompt, false otherwise
 */
export const isFirstPrompt = async (args: {
  cwd: string;
}): Promise<boolean> => {
  const { cwd } = args;
  const markerPath = getSessionMarkerPath({ cwd });

  try {
    // If marker file exists, this is not the first prompt
    await fs.access(markerPath);
    return false;
  } catch {
    // Marker file doesn't exist, this is the first prompt
    return true;
  }
};

/**
 * Mark that the first prompt has been handled for the given cwd
 * Creates a marker file to indicate that startup hooks have executed
 *
 * @param args - Arguments
 * @param args.cwd - Current working directory
 */
export const markFirstPromptHandled = async (args: {
  cwd: string;
}): Promise<void> => {
  const { cwd } = args;
  const markerPath = getSessionMarkerPath({ cwd });

  // Create marker file with session metadata
  const metadata = {
    cwd,
    timestamp: new Date().toISOString(),
  };

  await fs.writeFile(markerPath, JSON.stringify(metadata, null, 2));
};
