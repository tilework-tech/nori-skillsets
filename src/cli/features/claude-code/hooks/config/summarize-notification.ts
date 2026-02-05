#!/usr/bin/env node

/**
 * Hook handler for notifying user about transcript saving
 *
 * This script is called by Claude Code hooks on SessionEnd event.
 * It outputs a synchronous message to inform the user that the transcript
 * is being saved to Nori Profiles (while the async summarize hook runs in background).
 *
 * Uses exit code 2 to trigger Claude Code's failure display mechanism,
 * and ANSI escape codes to clear the "SessionEnd hook [path] failed:" prefix.
 */

import { loadConfig } from "@/cli/config.js";
import { debug, LOG_FILE } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import { formatWithLineClear } from "./format.js";

const ERROR_MESSAGE = `Error saving to Nori Watchtower. Check ${LOG_FILE} for details.\n`;

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
  const hookPath = getHookPath();

  // Load config to check if session transcripts are enabled
  // Find installation directory using getInstallDirs
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    // No installation found - show error to user
    debug({ message: "summarize-notification: No Nori installation found" });
    console.error(
      formatWithLineClear({
        message: ERROR_MESSAGE,
        hookPath,
        isSuccess: false,
      }),
    );
    process.exit(2);
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
    console.error(
      formatWithLineClear({
        message: ERROR_MESSAGE,
        hookPath,
        isSuccess: false,
      }),
    );
    process.exit(2);
    return;
  }

  let message;
  if (diskConfig?.sendSessionTranscript === "disabled") {
    message = formatWithLineClear({
      message:
        "Session transcripts disabled. Edit .nori-config.json to set sendSessionTranscript to enable.\n",
      hookPath,
      isSuccess: true,
    });
  } else {
    // Default to enabled behavior (backward compatible)
    message = formatWithLineClear({
      message: "Saving transcript to nori...\n",
      hookPath,
      isSuccess: true,
    });
  }

  console.error(message);
  process.exit(2);
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Show error to user for summarize hook
    debug({
      message: `summarize-notification: Unhandled error: ${err?.message || err}`,
    });
    console.error(
      formatWithLineClear({
        message: ERROR_MESSAGE,
        hookPath: getHookPath(),
        isSuccess: false,
      }),
    );
    process.exit(2);
  });
}
