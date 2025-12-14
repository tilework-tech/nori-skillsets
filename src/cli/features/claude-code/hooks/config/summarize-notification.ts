#!/usr/bin/env node

/**
 * Hook handler for notifying user about transcript saving
 *
 * This script is called by Claude Code hooks on SessionEnd event.
 * It outputs a synchronous message to inform the user that the transcript
 * is being saved to Nori Profiles (while the async summarize hook runs in background).
 */

import { loadConfig } from "@/cli/config.js";
import { debug, LOG_FILE } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import {
  formatError,
  formatSuccess,
} from "./intercepted-slashcommands/format.js";

const ERROR_MESSAGE = `Error saving to Nori Watchtower. Check ${LOG_FILE} for details.\n\n`;

/**
 * Main entry point
 */
export const main = async (): Promise<void> => {
  // Load config to check if session transcripts are enabled
  // Find installation directory using getInstallDirs
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // No installation found - show error to user
    debug({ message: "summarize-notification: No Nori installation found" });
    console.error(formatError({ message: ERROR_MESSAGE }));
    return;
  }

  const installDir = allInstallations[0]; // Use closest installation

  let diskConfig;
  try {
    diskConfig = await loadConfig({ installDir });
  } catch (err) {
    // Config loading failed - show error to user
    debug({
      message: `summarize-notification: Config load failed: ${err instanceof Error ? err.message : err}`,
    });
    console.error(formatError({ message: ERROR_MESSAGE }));
    return;
  }

  let message;
  if (diskConfig?.sendSessionTranscript === "disabled") {
    message = formatSuccess({
      message:
        "Session transcripts disabled. Use /nori-toggle-session-transcripts to enable...\n\n",
    });
  } else {
    // Default to enabled behavior (backward compatible)
    message = formatSuccess({
      message: "Saving transcript to nori...\n\n",
    });
  }

  console.error(message);
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Show error to user for summarize hook
    debug({
      message: `summarize-notification: Unhandled error: ${err?.message || err}`,
    });
    console.error(formatError({ message: ERROR_MESSAGE }));
    process.exit(0);
  });
}
