/**
 * Path utility functions for configurable installation directories
 */

import * as fs from "fs";
import * as path from "path";

import { getHomeDir } from "@/utils/home.js";

/**
 * Normalize an installation directory path
 * @param args - Configuration arguments
 * @param args.installDir - The installation directory (optional)
 *
 * @returns Absolute path to the base installation directory (defaults to home directory)
 */
export const normalizeInstallDir = (args: {
  installDir?: string | null;
}): string => {
  const { installDir } = args;

  // Use home directory if no installDir provided or empty
  if (installDir == null || installDir === "") {
    return getHomeDir();
  }

  let normalizedPath = installDir;

  // Expand tilde to home directory
  if (normalizedPath.startsWith("~/")) {
    normalizedPath = path.join(getHomeDir(), normalizedPath.slice(2));
  } else if (normalizedPath === "~") {
    normalizedPath = getHomeDir();
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
 * Check if a directory has a managed installation marker (.nori-managed or managed CLAUDE.md block)
 * @param dir - Directory to check
 *
 * @returns true if .claude/.nori-managed exists or .claude/CLAUDE.md contains NORI-AI MANAGED BLOCK
 */
const hasManagedBlock = (dir: string): boolean => {
  // Check for .nori-managed marker file (new style)
  const markerPath = path.join(dir, ".claude", ".nori-managed");
  if (fs.existsSync(markerPath)) {
    return true;
  }

  // Backwards compatibility: check CLAUDE.md for managed block
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
 * Get all directories that have Nori managed installations, starting from current directory
 * Searches current directory first, then ancestors
 * Only detects directories with .claude/CLAUDE.md containing a NORI-AI MANAGED BLOCK.
 *
 * @param args - Configuration arguments
 * @param args.currentDir - The directory to start searching from (defaults to process.cwd())
 *
 * @returns Array of paths to directories with Nori installations, ordered from closest to furthest.
 *   Returns empty array if no installations found.
 */
export const getInstallDirs = (args?: {
  currentDir?: string | null;
}): Array<string> => {
  const currentDir = args?.currentDir || process.cwd();
  const results: Array<string> = [];

  if (hasManagedBlock(currentDir)) {
    results.push(currentDir);
  }

  // Walk up the directory tree starting from parent
  let checkDir = path.dirname(currentDir);
  let previousDir = "";
  while (checkDir !== previousDir) {
    if (hasManagedBlock(checkDir)) {
      results.push(checkDir);
    }

    previousDir = checkDir;
    checkDir = path.dirname(checkDir);
  }

  return results;
};
