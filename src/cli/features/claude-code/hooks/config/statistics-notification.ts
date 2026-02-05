#!/usr/bin/env node

/**
 * Hook handler for notifying user about statistics calculation
 *
 * This script is called by Claude Code hooks on SessionEnd event.
 * It outputs a synchronous message to inform the user that statistics
 * are being calculated (before statistics.ts processes the transcript).
 *
 * Uses exit code 2 to trigger Claude Code's failure display mechanism,
 * and ANSI escape codes to clear the "SessionEnd hook [path] failed:" prefix.
 */

import { debug } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import { formatWithLineClear } from "./format.js";

/**
 * Get the hook script path for ANSI line clearing calculations
 *
 * @returns The path to this hook script from process.argv[1]
 */
const getHookPath = (): string => {
  return process.argv[1] || "";
};

/**
 * Main entry point
 */
export const main = async (): Promise<void> => {
  // Find installation directory using getInstallDirs
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // Silent failure - no installation found
    // Log to file only, don't show error to user, don't exit with code 2
    debug({ message: "statistics-notification: No Nori installation found" });
    return;
  }

  const hookPath = getHookPath();
  const message = formatWithLineClear({
    message: "Calculating Nori statistics... (Ctrl-C to exit early)\n",
    hookPath,
    isSuccess: true,
  });

  console.error(message);
  process.exit(2);
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Silent failure - notification hooks should not crash sessions
    // Log to file only
    debug({
      message: `statistics-notification: Unhandled error: ${err?.message || err}`,
    });
    process.exit(0);
  });
}
