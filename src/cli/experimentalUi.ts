/**
 * Experimental UI resolution logic
 *
 * Determines whether the experimental UI (clack-based TUI flows) should be
 * enabled based on multiple sources, in priority order:
 *
 * 1. CLI flag (--experimental-ui) — handled by commander, highest priority
 * 2. Config file (~/.nori-config.json experimentalUi field)
 * 3. Version auto-detection — enabled when version contains "next"
 */

import * as os from "os";

import { loadConfig } from "@/cli/config.js";

/**
 * Check if experimental UI should be automatically enabled.
 * This is called when the --experimental-ui CLI flag was NOT explicitly passed.
 *
 * Resolution order:
 * 1. Config file: ~/.nori-config.json { "experimentalUi": true }
 * 2. Version string: contains "next" (e.g., "0.7.0-next.1")
 *
 * @param args - Resolution arguments
 * @param args.version - The current package version string
 *
 * @returns true if experimental UI should be enabled
 */
export const shouldAutoEnableExperimentalUi = async (args: {
  version: string;
}): Promise<boolean> => {
  const { version } = args;

  // Check config file for manual override
  // Use os.homedir() since this is a user preference setting
  const config = await loadConfig({ startDir: os.homedir() });
  if (config?.experimentalUi === true) {
    return true;
  }

  // Auto-detect from version string containing "next"
  if (version.includes("next")) {
    return true;
  }

  return false;
};
