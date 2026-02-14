/**
 * Watch flow module
 *
 * Provides the interactive experience for starting the watch daemon,
 * including transcript destination org selection using @clack/prompts.
 */

import { intro, note, outro, select, spinner, log } from "@clack/prompts";

import { unwrapPrompt } from "./utils.js";

/**
 * Result of the onPrepare callback
 */
export type PrepareResult = {
  privateOrgs: Array<string>;
  currentDestination: string | null;
  isRunning: boolean;
};

/**
 * Result of the onStartDaemon callback
 */
export type StartDaemonResult =
  | { success: true; pid: number; logFile: string; transcriptsDir: string }
  | { success: false; error: string };

/**
 * Callbacks for the watch flow
 */
export type WatchFlowCallbacks = {
  onPrepare: () => Promise<PrepareResult>;
  onStartDaemon: (args: { org: string }) => Promise<StartDaemonResult>;
};

/**
 * Result of the watch flow
 */
export type WatchFlowResult = {
  org: string;
  pid: number;
  logFile: string;
} | null;

/**
 * Execute the interactive watch daemon startup flow
 *
 * This function handles the complete watch startup UX:
 * 1. Shows intro
 * 2. Stops existing daemon and loads config via onPrepare
 * 3. Selects transcript destination org (auto or prompted)
 * 4. Starts daemon via onStartDaemon
 * 5. Shows outro with PID and log file
 *
 * @param args - Flow configuration
 * @param args.forceSelection - Force re-selection of transcript destination
 * @param args.callbacks - Callback functions for prepare and daemon startup
 *
 * @returns Watch result on success, null on failure or cancellation
 */
export const watchFlow = async (args: {
  forceSelection?: boolean | null;
  callbacks: WatchFlowCallbacks;
}): Promise<WatchFlowResult> => {
  const { forceSelection, callbacks } = args;
  const cancelMsg = "Watch cancelled.";

  intro("nori watch");

  // Prepare: stop existing daemon if running, load config
  const s = spinner();
  s.start("Preparing...");
  const prepareResult = await callbacks.onPrepare();
  const { privateOrgs, currentDestination, isRunning } = prepareResult;

  if (isRunning) {
    s.stop("Stopped existing watch daemon.");
  } else {
    s.stop("Ready.");
  }

  // Determine transcript destination org
  let selectedOrg: string | null = null;

  if (privateOrgs.length === 0) {
    log.warn("No private organizations available. Cannot upload transcripts.");
    outro("Watch cancelled.");
    return null;
  } else if (
    !forceSelection &&
    currentDestination != null &&
    privateOrgs.includes(currentDestination)
  ) {
    // Reuse current destination
    selectedOrg = currentDestination;
  } else if (privateOrgs.length === 1) {
    // Auto-select only org
    selectedOrg = privateOrgs[0];
  } else {
    // Multiple orgs — prompt user
    const orgChoice = await select({
      message: "Select organization for transcript uploads:",
      options: privateOrgs.map((org) => ({ value: org, label: org })),
    });

    const unwrapped = unwrapPrompt({
      value: orgChoice,
      cancelMessage: cancelMsg,
    });
    if (unwrapped == null) {
      return null;
    }
    selectedOrg = unwrapped;
  }

  // Start daemon
  s.start("Starting watch daemon...");
  const daemonResult = await callbacks.onStartDaemon({ org: selectedOrg });
  if (!daemonResult.success) {
    s.stop("Failed to start watch daemon.");
    log.error(`Failed to start watch daemon: ${daemonResult.error}`);
    outro("Watch failed.");
    return null;
  }

  s.stop("Watch daemon started.");

  const noteLines = [
    `PID:          ${daemonResult.pid}`,
    `Logs:         ${daemonResult.logFile}`,
    `Transcripts:  ${daemonResult.transcriptsDir}`,
  ];
  note(noteLines.join("\n"), "Watch Details");

  outro("Watching for sessions.");

  return {
    org: selectedOrg,
    pid: daemonResult.pid,
    logFile: daemonResult.logFile,
  };
};
