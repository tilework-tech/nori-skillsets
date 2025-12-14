/**
 * Version tracking utilities for Nori Profiles installer
 *
 * Manages version tracking to ensure proper uninstallation of previous versions
 * before installing new versions.
 */

import { existsSync, readFileSync } from "fs";
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
 * Find the package root by walking up from the start directory
 * looking for package.json with name "nori-ai"
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
        if (pkg.name === "nori-ai") {
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
    // Verify it's the nori-ai package
    if (pkg.name === "nori-ai") {
      return pkg.version;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Get the installed version from .nori-config.json
 * Throws an error if config does not exist or has no version field.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @throws Error if version cannot be detected
 *
 * @returns The installed version string
 */
export const getInstalledVersion = async (args: {
  installDir: string;
}): Promise<string> => {
  const { installDir } = args;
  const config = await loadConfig({ installDir });
  if (config?.version == null) {
    throw new Error(
      "Installation out of date: no version field found in .nori-config.json file.",
    );
  }
  return config.version;
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

/**
 * Build the uninstall command for cleanup during installation.
 * Conditionally includes --agent flag based on installed version compatibility.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.agentName - Name of the agent being installed
 * @param args.installedVersion - Currently installed version
 *
 * @returns The uninstall command string
 */
export const buildUninstallCommand = (args: {
  installDir: string;
  agentName: string;
  installedVersion: string;
}): string => {
  const { installDir, agentName, installedVersion } = args;
  const base = `nori-ai uninstall --non-interactive --install-dir="${installDir}"`;

  if (supportsAgentFlag({ version: installedVersion })) {
    return `${base} --agent="${agentName}"`;
  }
  return base;
};
