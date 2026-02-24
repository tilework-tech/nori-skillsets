/**
 * Path utility functions for configurable installation directories
 */

import * as path from "path";

import { getHomeDir } from "@/utils/home.js";

/**
 * Tracks where the install directory was resolved from.
 * - "cli": Explicitly provided via --install-dir flag (transient override)
 * - "config": Read from persisted .nori-config.json
 * - "default": Fallback to home directory
 */
export type InstallDirSource = "cli" | "config" | "default";

/**
 * A resolved installation directory with provenance tracking.
 * The `source` field indicates where the path came from, allowing
 * downstream code to decide whether to persist config or skip manifest ops.
 */
export type ResolvedInstallDir = {
  path: string;
  source: InstallDirSource;
};

/**
 * Normalize an installation directory path
 * @param args - Configuration arguments
 * @param args.installDir - The installation directory (optional)
 * @param args.agentDirNames - Agent config directory basenames to strip from path suffixes (optional)
 *
 * @returns Absolute path to the base installation directory (defaults to home directory)
 */
export const normalizeInstallDir = (args: {
  installDir?: string | null;
  agentDirNames?: Array<string> | null;
}): string => {
  const { installDir, agentDirNames } = args;

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

  // If path ends with a known agent directory name, strip it to get the base directory
  if (agentDirNames != null && agentDirNames.length > 0) {
    const basename = path.basename(normalizedPath);
    if (agentDirNames.includes(basename)) {
      return path.dirname(normalizedPath);
    }
  }

  return normalizedPath;
};

/**
 * Resolve the installation directory using a priority chain:
 * 1. CLI --install-dir flag (highest priority, source: "cli")
 * 2. configInstallDir from persisted config (source: "config")
 * 3. Home directory (fallback, source: "default")
 *
 * @param args - Configuration arguments
 * @param args.cliInstallDir - Value from CLI --install-dir flag (optional)
 * @param args.configInstallDir - Value from persisted config installDir field (optional)
 * @param args.agentDirNames - Agent config directory basenames to strip from path suffixes (optional)
 *
 * @returns Resolved install directory with provenance tracking
 */
export const resolveInstallDir = (args: {
  cliInstallDir?: string | null;
  configInstallDir?: string | null;
  agentDirNames?: Array<string> | null;
}): ResolvedInstallDir => {
  const { cliInstallDir, configInstallDir, agentDirNames } = args;

  if (cliInstallDir != null && cliInstallDir !== "") {
    return {
      path: normalizeInstallDir({ installDir: cliInstallDir, agentDirNames }),
      source: "cli",
    };
  }

  if (configInstallDir != null && configInstallDir !== "") {
    return {
      path: normalizeInstallDir({
        installDir: configInstallDir,
        agentDirNames,
      }),
      source: "config",
    };
  }

  return { path: getHomeDir(), source: "default" };
};
