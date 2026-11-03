/**
 * npm postinstall entry point that stops a watch daemon left running by an
 * older version. Such a daemon keeps its old in-memory code after an upgrade
 * and would otherwise keep uploading transcripts until the machine restarts.
 */

import { watchStopMain } from "@/cli/commands/watch/watch.js";

const isDirectExecution =
  process.argv[1] != null &&
  (process.argv[1].endsWith("stopLegacyDaemon.js") ||
    process.argv[1].endsWith("stopLegacyDaemon.ts"));

if (isDirectExecution) {
  watchStopMain({ quiet: true }).catch(() => {
    // Best-effort: never fail an install.
    process.exit(0);
  });
}
