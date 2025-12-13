/**
 * Version tracking utilities for Nori Profiles installer
 *
 * Manages version tracking to ensure proper uninstallation of previous versions
 * before installing new versions.
 */

import { readFileSync } from "fs";
import { join } from "path";

import semver from "semver";

import { loadConfig } from "@/cli/config.js";
import { CLI_ROOT } from "@/cli/env.js";

const DEFAULT_VERSION = "12.1.0";

/**
 * Minimum version that supports the --agent CLI flag.
 * The --agent flag was introduced in 19.0.0 with multi-agent support.
 */
const MIN_AGENT_FLAG_VERSION = "19.0.0";

/**
 * Get the current package version by reading package.json
 * This works for any installation method (global npm install, local node_modules)
 * @returns The current package version or null if not found
 */
export const getCurrentPackageVersion = (): string | null => {
  try {
    const packageJsonPath = join(CLI_ROOT, "package.json");
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
 * Defaults to 12.1.0 if config does not exist or has no version
 * (assumes existing installations without version field are 12.1.0)
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns The installed version string
 */
export const getInstalledVersion = async (args: {
  installDir: string;
}): Promise<string> => {
  const { installDir } = args;
  try {
    const config = await loadConfig({ installDir });
    if (config?.version) {
      return config.version;
    }
    return DEFAULT_VERSION;
  } catch {
    // Config doesn't exist or can't be read - default to 12.1.0
    return DEFAULT_VERSION;
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
