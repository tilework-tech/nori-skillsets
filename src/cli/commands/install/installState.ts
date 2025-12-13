/**
 * Installation state utilities
 *
 * Functions for checking installation state that are used by both install.ts and uninstall.ts
 */

import { existsSync } from "fs";

import { getConfigPath } from "@/cli/config.js";

/**
 * Check if there's an existing installation
 * An installation exists if:
 * - Config file exists at <installDir>/.nori-config.json
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
  return existsSync(getConfigPath({ installDir }));
};
