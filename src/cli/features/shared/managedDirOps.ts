/**
 * Shared directory operations for managed-content loaders.
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Reset a managed destination directory before a loader repopulates it,
 * preserving any dotfile entries (e.g. an agent's own `.system/` cache that
 * Nori does not own).
 *
 * @param args - Configuration arguments
 * @param args.dir - Absolute path of the directory to reset
 */
export const resetManagedDir = async (args: { dir: string }): Promise<void> => {
  const { dir } = args;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    await fs.mkdir(dir, { recursive: true });
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    await fs.rm(path.join(dir, entry.name), {
      recursive: true,
      force: true,
    });
  }

  await fs.mkdir(dir, { recursive: true });
};
