/**
 * Path utility functions for configurable installation directories
 */

import * as path from "path";

import { type Config } from "@/cli/config.js";
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
 * Resolve the installation directory using a priority chain:
 * 1. CLI --install-dir flag (highest priority)
 * 2. config.installDir from persisted config
 * 3. Home directory (fallback)
 *
 * @param args - Configuration arguments
 * @param args.cliInstallDir - Value from CLI --install-dir flag (optional)
 * @param args.config - Loaded config object (optional)
 *
 * @returns Resolved absolute path to the installation directory
 */
export const resolveInstallDir = (args: {
  cliInstallDir?: string | null;
  config?: Config | null;
}): string => {
  const { cliInstallDir, config } = args;

  if (cliInstallDir != null && cliInstallDir !== "") {
    return normalizeInstallDir({ installDir: cliInstallDir });
  }

  if (config?.installDir != null && config.installDir !== "") {
    return normalizeInstallDir({ installDir: config.installDir });
  }

  return getHomeDir();
};
