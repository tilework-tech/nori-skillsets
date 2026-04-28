/**
 * Version tracking utilities for Nori Skillsets installer
 *
 * Manages version tracking for the Nori Skillsets installer.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, parse, resolve } from "path";
import { fileURLToPath } from "url";

import semver from "semver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Minimum version that supports the --agent CLI flag.
 * The --agent flag was introduced in 19.0.0 with multi-agent support.
 */
const MIN_AGENT_FLAG_VERSION = "19.0.0";

/**
 * Valid package names that this version module can detect.
 */
const VALID_PACKAGE_NAMES = ["nori-skillsets"];

/**
 * Find the package root by walking up from the start directory
 * looking for package.json with a valid Nori package name
 *
 * @param args - Configuration arguments
 * @param args.startDir - Directory to start searching from
 *
 * @returns The path to the package root directory or null if not found
 */
const findPackageRoot = (args: { startDir: string }): string | null => {
  const { startDir } = args;
  let currentDir = resolve(startDir);
  const root = parse(currentDir).root;
  const maxDepth = 10;
  let depth = 0;

  while (currentDir !== root && depth < maxDepth) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        if (VALID_PACKAGE_NAMES.includes(pkg.name)) {
          return currentDir;
        }
      } catch {
        // Invalid JSON, continue searching
      }
    }
    currentDir = dirname(currentDir);
    depth++;
  }

  return null;
};

/**
 * Get the current package version by reading package.json
 * This works for any installation method (global npm install, local node_modules)
 *
 * @param args - Optional configuration arguments
 * @param args.startDir - Directory to start searching from (defaults to current file's directory)
 *
 * @returns The current package version or null if not found
 */
export const getCurrentPackageVersion = (args?: {
  startDir?: string | null;
}): string | null => {
  const startDir = args?.startDir ?? __dirname;

  const packageRoot = findPackageRoot({ startDir });
  if (packageRoot == null) {
    return null;
  }

  try {
    const packageJsonPath = join(packageRoot, "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    // Verify it's a valid Nori package
    if (VALID_PACKAGE_NAMES.includes(pkg.name)) {
      return pkg.version;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Check if a version supports the --agent CLI flag.
 * Returns false for invalid versions (fail-safe behavior).
 *
 * @param args - Configuration arguments
 * @param args.version - Version string to check
 *
 * @returns true if version supports --agent flag, false otherwise
 */
export const supportsAgentFlag = (args: { version: string }): boolean => {
  const { version } = args;
  try {
    return semver.gte(version, MIN_AGENT_FLAG_VERSION) ?? false;
  } catch {
    // Invalid version string - fail-safe to false
    return false;
  }
};
