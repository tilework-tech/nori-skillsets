/**
 * Stale Transcript Scanner
 *
 * Scans transcript directories for .jsonl files that haven't been
 * modified recently (considered "stale" and ready for upload).
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Find stale transcript files in a directory
 *
 * Recursively scans the given directory for .jsonl files that
 * haven't been modified within the specified time threshold.
 *
 * @param args - Configuration arguments
 * @param args.transcriptDir - Directory to scan for transcripts
 * @param args.maxAgeMs - Maximum age in milliseconds before a file is considered stale
 *
 * @returns Array of absolute paths to stale transcript files
 */
export const findStaleTranscripts = async (args: {
  transcriptDir: string;
  maxAgeMs: number;
}): Promise<Array<string>> => {
  const { transcriptDir, maxAgeMs } = args;

  const staleFiles: Array<string> = [];
  const now = Date.now();

  // Check if directory exists
  try {
    await fs.access(transcriptDir);
  } catch {
    // Directory doesn't exist, return empty array
    return [];
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

          if (age > maxAgeMs) {
            staleFiles.push(fullPath);
          }
        } catch {
          // Can't stat file, skip
        }
      }
    }
  };

  await scanDirectory(transcriptDir);

  return staleFiles;
};
