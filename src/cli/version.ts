/**
 * Version tracking utilities for Nori Profiles installer
 *
 * Manages version tracking for the Nori Profiles installer.
 */

import { existsSync, readFileSync } from "fs";
import * as os from "os";
import { dirname, join, parse, resolve } from "path";
import { fileURLToPath } from "url";

import semver from "semver";

import { loadConfig } from "@/cli/config.js";

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
 * Get the installed version from .nori-config.json
 * Falls back to reading from deprecated .nori-installed-version file if config has no version.
 * Throws an error if version cannot be detected from either source.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @throws Error if version cannot be detected from config or fallback file
 *
 * @returns The installed version string
 */
export const getInstalledVersion = async (args: {
  installDir: string;
}): Promise<string> => {
  const { installDir } = args;
  // Use os.homedir() since version is stored in global config
  const config = await loadConfig({ startDir: os.homedir() });

  // If config has version, use it
  if (config?.version != null) {
    return config.version;
  }

  // Try fallback to deprecated .nori-installed-version file
  const versionFilePath = join(installDir, ".nori-installed-version");
  if (existsSync(versionFilePath)) {
    const fileContent = readFileSync(versionFilePath, "utf-8").trim();
    if (semver.valid(fileContent) != null) {
      return fileContent;
    }
  }

  throw new Error(
    "Installation out of date: no version field found in .nori-config.json file.",
  );
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
