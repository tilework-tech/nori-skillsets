/**
 * Watch flow module
 *
 * Provides the interactive experience for starting the watch daemon,
 * including transcript destination org selection using @clack/prompts.
 */

import { note, select, confirm, spinner, log } from "@clack/prompts";

import { unwrapPrompt } from "./utils.js";

/**
 * Result of the onPrepare callback
 */
export type PrepareResult = {
  privateOrgs: Array<string>;
  currentDestination: string | null;
  currentGarbageCollect: "enabled" | "disabled" | null;
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
  onStartDaemon: (args: {
    org: string;
    garbageCollect: "enabled" | "disabled";
  }) => Promise<StartDaemonResult>;
};

/**
 * Result of the watch flow
 */
export type WatchFlowResult = {
  org: string;
  pid: number;
  logFile: string;
  statusMessage: string;
} | null;

/**
 * Execute the interactive watch daemon startup flow
 *
 * This function handles the complete watch startup UX:
 * 1. Stops existing daemon and loads config via onPrepare
 * 2. Selects transcript destination org (auto or prompted)
 * 3. Starts daemon via onStartDaemon
 * 4. Shows note with PID and log file
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

  // Prepare: stop existing daemon if running, load config
  const s = spinner();
  s.start("Preparing...");
  const prepareResult = await callbacks.onPrepare();
  const { privateOrgs, currentDestination, currentGarbageCollect, isRunning } =
    prepareResult;

  if (isRunning) {
    s.stop("Stopped existing watch daemon.");
  } else {
    s.stop("Ready.");
  }

  // Determine transcript destination org
  let selectedOrg: string | null = null;

  if (privateOrgs.length === 0) {
    log.warn("No private organizations available. Cannot upload transcripts.");
    return {
      org: "",
      pid: 0,
      logFile: "",
      statusMessage: "Watch cancelled.",
    };
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

  // Prompt for garbage collection preference
  const gcChoice = await confirm({
    message: "Delete transcript files after successful upload?",
    initialValue: currentGarbageCollect === "enabled",
  });

  const gcUnwrapped = unwrapPrompt({
    value: gcChoice,
    cancelMessage: cancelMsg,
  });
  if (gcUnwrapped == null) {
    return null;
  }
  const garbageCollect = gcUnwrapped ? "enabled" : "disabled";

  // Start daemon
  s.start("Starting watch daemon...");
  const daemonResult = await callbacks.onStartDaemon({
    org: selectedOrg,
    garbageCollect,
  });
  if (!daemonResult.success) {
    s.stop("Failed to start watch daemon.");
    log.error(`Failed to start watch daemon: ${daemonResult.error}`);
    return {
      org: selectedOrg,
      pid: 0,
      logFile: "",
      statusMessage: "Watch failed.",
    };
  }

  s.stop("Watch daemon started.");

  const noteLines = [
    `PID:          ${daemonResult.pid}`,
    `Logs:         ${daemonResult.logFile}`,
    `Transcripts:  ${daemonResult.transcriptsDir}`,
  ];
  note(noteLines.join("\n"), "Watch Details");

  return {
    org: selectedOrg,
    pid: daemonResult.pid,
    logFile: daemonResult.logFile,
    statusMessage: "Watching for sessions.",
  };
};
