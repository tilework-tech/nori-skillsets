#!/usr/bin/env node

/**
 * Hook handler for notifying user about statistics calculation
 *
 * This script is called by Claude Code hooks on SessionEnd event.
 * It outputs a synchronous message to inform the user that statistics
 * are being calculated (before statistics.ts processes the transcript).
 */

import { debug } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import { formatSuccess } from "./intercepted-slashcommands/format.js";

/**
 * Main entry point
 */
export const main = async (): Promise<void> => {
  // Find installation directory using getInstallDirs
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // Silent failure - no installation found
    // Log to file only, don't show error to user
    debug({ message: "statistics-notification: No Nori installation found" });
    return;
  }

  const message = formatSuccess({
    message: "Calculating Nori statistics... (Ctrl-C to exit early)\n\n",
  });

  console.error(message);
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
