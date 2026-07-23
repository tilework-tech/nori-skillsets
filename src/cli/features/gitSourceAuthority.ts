import * as fs from "node:fs/promises";
import * as path from "node:path";

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  ((error as NodeJS.ErrnoException).code === "ENOENT" ||
    (error as NodeJS.ErrnoException).code === "ENOTDIR");

const resolveNearestExistingPath = async (
  targetPath: string,
): Promise<string> => {
  let candidate = path.resolve(targetPath);

  while (true) {
    try {
      return await fs.realpath(candidate);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
};

/**
 * Determine whether a path is governed by a Git repository.
 *
 * Existing paths are resolved before inspection. For a path that does not yet
 * exist, inspection begins at its nearest existing ancestor so a new Registrar
 * package cannot be created inside an existing Git working tree.
 *
 * @param args - Function arguments
 * @param args.targetPath - Existing or proposed filesystem path
 *
 * @returns True when the path or a real-path ancestor contains a `.git` entry
 */
export const isGitGovernedPath = async (args: {
  targetPath: string;
}): Promise<boolean> => {
  let currentPath = await resolveNearestExistingPath(args.targetPath);

  while (true) {
    try {
      await fs.lstat(path.join(currentPath, ".git"));
      return true;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }

    const parent = path.dirname(currentPath);
    if (parent === currentPath) return false;
    currentPath = parent;
  }
};
