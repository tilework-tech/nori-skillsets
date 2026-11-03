/**
 * Watch Command
 *
 * Transcript upload to registrars has been retired. `watch` is kept so that
 * existing scripts and daemons do not break: it stops any watch daemon left
 * running by an older version and exits without uploading anything.
 */

import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";

import {
  getWatchLogFile,
  getWatchPidFile,
} from "@/cli/commands/watch/paths.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

export const WATCH_RETIRED_MESSAGE =
  "Transcript upload has been retired. `nori-skillsets watch` no longer watches or uploads sessions.";

const STOP_TIMEOUT_MS = 2000;
const STOP_POLL_MS = 50;

const execFileAsync = promisify(execFile);

/**
 * Append a line to the watch log. Used in background mode, where stdout and
 * stderr are detached.
 *
 * @param args - Configuration arguments
 * @param args.message - The message to log
 */
const appendToWatchLog = async (args: { message: string }): Promise<void> => {
  const { message } = args;
  const logFile = getWatchLogFile();
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.appendFile(
    logFile,
    `[${new Date().toISOString()}] ${message}\n`,
    "utf-8",
  );
};

/**
 * Read the PID of a previously started watch daemon, if any
 *
 * @returns The daemon PID, or null when no valid PID file exists
 */
const readDaemonPid = async (): Promise<number | null> => {
  let pidContent: string;
  try {
    pidContent = await fs.readFile(getWatchPidFile(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
  const pid = parseInt(pidContent.trim(), 10);
  return isNaN(pid) || pid <= 0 ? null : pid;
};

/**
 * Read a process's command line. Uses /proc on Linux and falls back to `ps`
 * (macOS).
 *
 * @param args - Configuration arguments
 * @param args.pid - Process ID
 *
 * @returns The command line, or null if the process does not exist
 */
const readCommandLine = async (args: {
  pid: number;
}): Promise<string | null> => {
  const { pid } = args;
  try {
    const raw = await fs.readFile(`/proc/${pid}/cmdline`, "utf-8");
    return raw.split("\0").join(" ");
  } catch {
    // Not Linux, or the process is gone; fall through to ps.
  }
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "command=",
      "-p",
      String(pid),
    ]);
    const commandLine = stdout.trim();
    return commandLine === "" ? null : commandLine;
  } catch {
    return null;
  }
};

/**
 * Whether a PID belongs to a watch daemon spawned by an older version
 * (`<node> <cli> watch --agent <agent> --_background`). Guards against
 * signalling an unrelated process that reused a stale PID.
 *
 * @param args - Configuration arguments
 * @param args.pid - Process ID
 *
 * @returns True if the process is a legacy watch daemon
 */
const isLegacyWatchDaemon = async (args: { pid: number }): Promise<boolean> => {
  const commandLine = await readCommandLine(args);
  if (commandLine == null) {
    return false;
  }
  const argv = commandLine.split(/\s+/);
  return argv.includes("watch") && argv.includes("--_background");
};

/**
 * Whether a process is still running. A zombie (exited but not yet reaped,
 * e.g. under a container PID 1 that never reaps) counts as exited.
 *
 * @param args - Configuration arguments
 * @param args.pid - Process ID
 *
 * @returns True if the process exists and is not a zombie
 */
const isProcessAlive = async (args: { pid: number }): Promise<boolean> => {
  const { pid } = args;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, "utf-8");
    // Format: "<pid> (<comm>) <state> ..."; comm may contain spaces.
    const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
    return state !== "Z";
  } catch {
    // No /proc (macOS): kill(0) succeeding is the best signal available.
    return true;
  }
};

const waitForProcessExit = async (args: { pid: number }): Promise<boolean> => {
  const { pid } = args;
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await isProcessAlive({ pid }))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  return !(await isProcessAlive({ pid }));
};

/**
 * Main watch function
 *
 * @param args - Configuration arguments
 * @param args.agent - Accepted for backwards compatibility; ignored
 * @param args.setDestination - Accepted for backwards compatibility; ignored
 * @param args._background - Set when launched as a daemon by an older version
 *
 * @returns Command status
 */
export const watchMain = async (args?: {
  agent?: string | null;
  _background?: boolean | null;
  setDestination?: boolean | null;
}): Promise<CommandStatus> => {
  const _background = args?._background ?? false;

  if (_background) {
    await appendToWatchLog({ message: WATCH_RETIRED_MESSAGE });
    return { success: true, cancelled: false, message: WATCH_RETIRED_MESSAGE };
  }

  const { stoppedPid } = await watchStopMain({ quiet: true });
  const message =
    stoppedPid == null
      ? WATCH_RETIRED_MESSAGE
      : `Stopped legacy watch daemon (PID ${stoppedPid}). ${WATCH_RETIRED_MESSAGE}`;

  return { success: true, cancelled: false, message };
};

/**
 * Stop a watch daemon started by an older version of nori-skillsets
 *
 * @param args - Configuration arguments
 * @param args.quiet - Suppress output
 *
 * @returns The PID of the daemon that was stopped, or null if none was
 */
export const watchStopMain = async (args?: {
  quiet?: boolean | null;
}): Promise<{ stoppedPid: number | null }> => {
  const quiet = args?.quiet ?? false;

  const clack = await import("@clack/prompts");

  const daemonPid = await readDaemonPid();
  await fs.rm(getWatchPidFile(), { force: true });

  if (
    daemonPid == null ||
    daemonPid === process.pid ||
    !(await isLegacyWatchDaemon({ pid: daemonPid }))
  ) {
    if (!quiet) {
      clack.log.info("No watch daemon running");
    }
    return { stoppedPid: null };
  }

  try {
    process.kill(daemonPid, "SIGTERM");
  } catch {
    if (!quiet) {
      clack.log.info("No watch daemon running");
    }
    return { stoppedPid: null };
  }

  const exited = await waitForProcessExit({ pid: daemonPid });
  if (!exited) {
    if (!quiet) {
      clack.log.warn(
        `Sent SIGTERM to watch daemon (PID ${daemonPid}) but it is still running`,
      );
    }
    return { stoppedPid: null };
  }

  if (!quiet) {
    clack.log.success(`Watch daemon stopped (PID ${daemonPid})`);
  }
  return { stoppedPid: daemonPid };
};
