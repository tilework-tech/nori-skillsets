/**
 * Installation state utilities
 *
 * Functions for checking installation state
 */

import { existsSync } from "fs";

import { getConfigPath } from "@/cli/config.js";

/**
 * Check if there's an existing installation
 * An installation exists if:
 * - Config file exists at ~/.nori-config.json
 *
 * @returns true if an installation exists, false otherwise
 */
export const hasExistingInstallation = (): boolean => {
  return existsSync(getConfigPath());
};
