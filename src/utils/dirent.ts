import * as fs from "fs/promises";
import * as path from "path";

import type { Dirent } from "fs";

/**
 * Check if a dirent entry is a directory, following symlinks.
 *
 * `Dirent.isDirectory()` returns false for symlinks to directories.
 * This helper also checks symlinks via `fs.stat` to follow them.
 * @param args - Function arguments
 * @param args.parentDir - The parent directory containing the entry
 * @param args.entry - The dirent entry to check
 *
 * @returns True if the entry is a directory or a symlink to a directory
 */
export const isDirentDirectory = async (args: {
  parentDir: string;
  entry: Dirent;
}): Promise<boolean> => {
  const { parentDir, entry } = args;
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      const fullPath = path.join(parentDir, entry.name);
      const stat = await fs.stat(fullPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * Check if a dirent entry is a file, following symlinks.
 *
 * `Dirent.isFile()` returns false for symlinks to files.
 * This helper also checks symlinks via `fs.stat` to follow them.
 * @param args - Function arguments
 * @param args.parentDir - The parent directory containing the entry
 * @param args.entry - The dirent entry to check
 *
 * @returns True if the entry is a file or a symlink to a file
 */
export const isDirentFile = async (args: {
  parentDir: string;
  entry: Dirent;
}): Promise<boolean> => {
  const { parentDir, entry } = args;
  if (entry.isFile()) return true;
  if (entry.isSymbolicLink()) {
    try {
      const fullPath = path.join(parentDir, entry.name);
      const stat = await fs.stat(fullPath);
      return stat.isFile();
    } catch {
      return false;
    }
  }
  return false;
};
