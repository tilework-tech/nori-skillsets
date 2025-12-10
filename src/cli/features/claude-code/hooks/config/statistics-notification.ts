#!/usr/bin/env node

/**
 * Hook handler for notifying user about statistics calculation
 *
 * This script is called by Claude Code hooks on SessionEnd event.
 * It outputs a synchronous message to inform the user that statistics
 * are being calculated (before statistics.ts processes the transcript).
 */

import { getInstallDirs } from "@/utils/path.js";

/**
 * Main entry point
 */
export const main = async (): Promise<void> => {
  // Find installation directory using getInstallDirs
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // Silent failure - no installation found
    // Don't show error to user, just skip notification
    return;
  }

  const output = {
    systemMessage: "Calculating Nori statistics... (Ctrl-C to exit early)\n\n",
  };

  console.log(JSON.stringify(output));
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    // Silent failure - notification hooks should not crash sessions
    process.exit(0);
  });
}
