/**
 * Version tracking utilities for Nori Profiles installer
 *
 * Manages version tracking to ensure proper uninstallation of previous versions
 * before installing new versions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { MCP_ROOT } from "@/installer/env.js";

const DEFAULT_VERSION = "12.1.0";

/**
 * Get the path to the version file
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns The absolute path to .nori-installed-version
 */
export const getVersionFilePath = (args: { installDir: string }): string => {
  const { installDir } = args;
  return join(installDir, ".nori-installed-version");
};

/**
 * Check if there's an existing installation
 * An installation exists if:
 * - Version file exists at <installDir>/.nori-installed-version
 * - OR config file exists at <installDir>/.nori-config.json
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns true if an installation exists, false otherwise
 */
export const hasExistingInstallation = (args: {
  installDir: string;
}): boolean => {
  const { installDir } = args;
  const versionFileExists = existsSync(getVersionFilePath({ installDir }));
  const configFilePath = join(installDir, ".nori-config.json");
  const configFileExists = existsSync(configFilePath);
  return versionFileExists || configFileExists;
};

/**
 * Get the current package version by reading package.json
 * This works for any installation method (global npm, npx, local node_modules)
 * @returns The current package version or null if not found
 */
export const getCurrentPackageVersion = (): string | null => {
  try {
    const packageJsonPath = join(MCP_ROOT, "package.json");
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
 * Get the installed version from .nori-installed-version
 * Defaults to 12.1.0 if file does not exist (assumes existing installations are 12.1.0)
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 *
 * @returns The installed version string
 */
export const getInstalledVersion = (args: { installDir: string }): string => {
  const { installDir } = args;
  try {
    const version = readFileSync(
      getVersionFilePath({ installDir }),
      "utf-8",
    ).trim();
    if (version) {
      return version;
    }
    return DEFAULT_VERSION;
  } catch {
    // File doesn't exist or can't be read - default to 12.1.0
    return DEFAULT_VERSION;
  }
};

/**
 * Save the installed version to .nori-installed-version
 * @param args - Configuration arguments
 * @param args.version - Version to save
 * @param args.installDir - Installation directory
 */
export const saveInstalledVersion = (args: {
  version: string;
  installDir: string;
}): void => {
  const { version, installDir } = args;
  const versionFilePath = getVersionFilePath({ installDir });

  // Ensure the directory exists
  const dir = dirname(versionFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(versionFilePath, version, "utf-8");
};
