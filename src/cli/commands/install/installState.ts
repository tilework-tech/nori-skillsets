/**
 * Installation state utilities
 *
 * Functions for checking installation state that are used by both install.ts and uninstall.ts
 */

import { existsSync } from "fs";

import { getConfigPath } from "@/cli/config.js";
import { getVersionFilePath } from "@/cli/version.js";

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
  const configFileExists = existsSync(getConfigPath({ installDir }));
  return versionFileExists || configFileExists;
};
