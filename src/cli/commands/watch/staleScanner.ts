/**
 * Stale Transcript Scanner
 *
 * Scans transcript directories for .jsonl files that haven't been
 * modified recently (considered "stale" and ready for upload).
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Result of scanning for stale transcripts
 */
export type StaleScanResult = {
  /** Files ready for upload (stale but not yet expired) */
  staleFiles: Array<string>;
  /** Files that have been idle too long and should be deleted */
  expiredFiles: Array<string>;
};

/**
 * Find stale and expired transcript files in a directory
 *
 * Recursively scans the given directory for .jsonl files:
 * - Files older than staleThresholdMs but younger than expireThresholdMs are "stale" (ready for upload)
 * - Files older than expireThresholdMs are "expired" (should be deleted)
 *
 * @param args - Configuration arguments
 * @param args.transcriptDir - Directory to scan for transcripts
 * @param args.staleThresholdMs - Age in ms after which a file is considered stale (ready for upload)
 * @param args.expireThresholdMs - Age in ms after which a file should be deleted
 *
 * @returns Object containing arrays of stale and expired file paths
 */
export const findStaleTranscripts = async (args: {
  transcriptDir: string;
  staleThresholdMs: number;
  expireThresholdMs: number;
}): Promise<StaleScanResult> => {
  const { transcriptDir, staleThresholdMs, expireThresholdMs } = args;

  const staleFiles: Array<string> = [];
  const expiredFiles: Array<string> = [];
  const now = Date.now();

  // Check if directory exists
  try {
    await fs.access(transcriptDir);
  } catch {
    // Directory doesn't exist, return empty arrays
    return { staleFiles, expiredFiles };
  }

  // Recursively scan directory
  const scanDirectory = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Can't read directory, skip
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectory
        await scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        // Check file age
        try {
          const stats = await fs.stat(fullPath);
          const age = now - stats.mtime.getTime();

          if (age > expireThresholdMs) {
            // File is expired - should be deleted
            expiredFiles.push(fullPath);
          } else if (age > staleThresholdMs) {
            // File is stale but not expired - ready for upload
            staleFiles.push(fullPath);
          }
        } catch {
          // Can't stat file, skip
        }
      }
    }
  };

  await scanDirectory(transcriptDir);

  return { staleFiles, expiredFiles };
};
