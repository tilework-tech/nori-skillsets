/**
 * Path utility functions for configurable installation directories
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Normalize an installation directory path
 * @param args - Configuration arguments
 * @param args.installDir - The installation directory (optional)
 *
 * @returns Absolute path to the base installation directory
 */
export const normalizeInstallDir = (args: {
  installDir?: string | null;
}): string => {
  const { installDir } = args;

  // Use current working directory if no installDir provided or empty
  if (installDir == null || installDir === "") {
    return process.cwd();
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

  // Normalize the path (resolves . and .., normalizes multiple slashes)
  normalizedPath = path.normalize(normalizedPath);

  // Remove trailing slash if present (except for root)
  if (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  // If path ends with .claude, strip it to get the base directory
  if (path.basename(normalizedPath) === ".claude") {
    return path.dirname(normalizedPath);
  }

  return normalizedPath;
};

/**
 * Check if a directory has a Nori installation
 * @param args - Configuration arguments
 * @param args.dir - The directory to check
 *
 * @returns true if Nori is installed in this directory
 */
const hasNoriInstallation = (args: { dir: string }): boolean => {
  const { dir } = args;

  // Check for .nori-config.json (new style)
  const newConfigPath = path.join(dir, ".nori-config.json");
  if (fs.existsSync(newConfigPath)) {
    return true;
  }

  // Check for nori-config.json (legacy style)
  const legacyConfigPath = path.join(dir, "nori-config.json");
  if (fs.existsSync(legacyConfigPath)) {
    return true;
  }

  // Check for .claude/CLAUDE.md with NORI-AI MANAGED BLOCK
  const claudeMdPath = path.join(dir, ".claude", "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    try {
      const content = fs.readFileSync(claudeMdPath, "utf-8");
      if (content.includes("NORI-AI MANAGED BLOCK")) {
        return true;
      }
    } catch {
      // Ignore read errors
    }
  }

  return false;
};

/**
 * Find all ancestor directories that have Nori installations
 * @param args - Configuration arguments
 * @param args.installDir - The installation directory to check from
 *
 * @returns Array of paths to ancestor directories with Nori installations, ordered from closest to furthest
 */
export const findAncestorInstallations = (args: {
  installDir: string;
}): Array<string> => {
  const { installDir } = args;
  const results: Array<string> = [];

  // Get the parent directory of the .claude directory
  // If installDir is /foo/bar/.claude, we start checking from /foo (not /foo/bar)
  let currentDir = path.dirname(installDir);

  // If the installDir ends with .claude, get the grandparent
  if (path.basename(installDir) === ".claude") {
    currentDir = path.dirname(currentDir);
  }

  // Walk up the directory tree
  let previousDir = "";
  while (currentDir !== previousDir) {
    if (hasNoriInstallation({ dir: currentDir })) {
      results.push(currentDir);
    }

    previousDir = currentDir;
    currentDir = path.dirname(currentDir);
  }

  return results;
};
