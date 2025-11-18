/**
 * Path utility functions for configurable installation directories
 */

import * as os from "os";
import * as path from "path";

/**
 * Normalize an installation directory path
 * @param args - Configuration arguments
 * @param args.installDir - The installation directory (optional)
 *
 * @returns Absolute path to the .claude directory
 */
export const normalizeInstallDir = (args: {
  installDir?: string | null;
}): string => {
  const { installDir } = args;

  // Use current working directory if no installDir provided or empty
  if (installDir == null || installDir === "") {
    return path.join(process.cwd(), ".claude");
  }

  let normalizedPath = installDir;

  // Expand tilde to home directory
  if (normalizedPath.startsWith("~/")) {
    normalizedPath = path.join(os.homedir(), normalizedPath.slice(2));
  } else if (normalizedPath === "~") {
    normalizedPath = os.homedir();
  }

  // Resolve relative paths to absolute
  if (!path.isAbsolute(normalizedPath)) {
    normalizedPath = path.join(process.cwd(), normalizedPath);
  }

  // Normalize the path (removes trailing slashes, resolves . and .., normalizes multiple slashes)
  normalizedPath = path.normalize(normalizedPath);

  // If path already ends with .claude, return as-is
  if (path.basename(normalizedPath) === ".claude") {
    return normalizedPath;
  }

  // Append .claude to the path
  return path.join(normalizedPath, ".claude");
};
