#!/usr/bin/env node

/**
 * Hook handler for notifying user about transcript saving
 *
 * This script is called by Claude Code hooks on SessionEnd event.
 * It outputs a synchronous message to inform the user that the transcript
 * is being saved to Nori Profiles (while the async summarize hook runs in background).
 */

import { loadDiskConfig } from "@/installer/config.js";

/**
 * Main entry point
 */
export const main = async (): Promise<void> => {
  // Load config to check if session transcripts are enabled
  const diskConfig = await loadDiskConfig();

  let output;
  if (diskConfig?.sendSessionTranscript === "disabled") {
    output = {
      systemMessage:
        "Session transcripts disabled. Use /nori-toggle-session-transcripts to enable...\n\n",
    };
  } else {
    // Default to enabled behavior (backward compatible)
    output = {
      systemMessage: "Saving transcript to nori...\n\n",
    };
  }

  console.log(JSON.stringify(output));
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    // Silent failure - notification hooks should not crash sessions
    process.exit(0);
  });
}
