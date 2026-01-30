/**
 * Watch Command
 *
 * Monitors Claude Code sessions and saves transcripts to ~/.nori/transcripts/
 * Runs as a background daemon with PID file management.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { extractSessionId } from "@/cli/commands/watch/parser.js";
import {
  getClaudeProjectsDir,
  getTranscriptDir,
  getWatchLogFile,
  getWatchPidFile,
} from "@/cli/commands/watch/paths.js";
import { copyTranscript } from "@/cli/commands/watch/storage.js";
import {
  createWatcher,
  stopWatcher,
  waitForWatcherReady,
} from "@/cli/commands/watch/watcher.js";
import { info, success, warn } from "@/cli/logger.js";

/**
 * Log stream for daemon mode
 */
let logStream: fs.FileHandle | null = null;

/**
 * Flag to track if we're shutting down
 */
let isShuttingDown = false;

/**
 * Signal handler reference for cleanup
 */
let signalHandler: (() => void) | null = null;

/**
 * Log a message (to file in daemon mode, console otherwise)
 *
 * @param message - The message to log
 */
const log = async (message: string): Promise<void> => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  if (logStream != null) {
    try {
      await logStream.write(logMessage);
    } catch {
      // Ignore write errors during shutdown
    }
  } else {
    process.stdout.write(logMessage);
  }
};

/**
 * Check if the watch daemon is running
 *
 * @returns True if daemon is running, false otherwise
 */
export const isWatchRunning = async (): Promise<boolean> => {
  const pidFile = getWatchPidFile();

  try {
    const pidContent = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(pidContent.trim(), 10);

    if (isNaN(pid)) {
      return false;
    }

    // Check if process is running
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      // Process doesn't exist
      return false;
    }
  } catch {
    // PID file doesn't exist
    return false;
  }
};

/**
 * Handle a file event from the watcher
 *
 * @param args - Configuration arguments
 * @param args.filePath - Path to the changed file
 * @param args.agent - Agent name for organizing transcripts
 */
const handleFileEvent = async (args: {
  filePath: string;
  agent: string;
}): Promise<void> => {
  const { filePath, agent } = args;

  if (isShuttingDown) {
    return;
  }

  try {
    // Extract sessionId from the file
    const sessionId = await extractSessionId({ filePath });

    if (sessionId == null) {
      await log(`Skipping ${filePath}: no sessionId found`);
      return;
    }

    // Get the project name from the directory structure
    const projectsDir = getClaudeProjectsDir();
    const relativePath = path.relative(projectsDir, filePath);
    const projectName = relativePath.split(path.sep)[0];

    if (projectName == null) {
      await log(`Skipping ${filePath}: could not determine project`);
      return;
    }

    // Get destination directory
    const destDir = getTranscriptDir({ agent, projectName });

    // Copy the transcript
    await copyTranscript({
      sourceFile: filePath,
      destDir,
      sessionId,
    });

    await log(`Copied ${sessionId} from ${projectName}`);
  } catch (err) {
    await log(`Error processing ${filePath}: ${err}`);
  }
};

/**
 * Clean up watch daemon resources
 *
 * @param args - Configuration arguments
 * @param args.exitProcess - Whether to call process.exit (false for tests)
 */
export const cleanupWatch = async (args?: {
  exitProcess?: boolean | null;
}): Promise<void> => {
  const exitProcess = args?.exitProcess ?? true;

  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  await log("Shutting down watch daemon...");

  stopWatcher();

  // Remove PID file
  const pidFile = getWatchPidFile();
  try {
    await fs.unlink(pidFile);
  } catch {
    // Ignore errors
  }

  // Close log stream
  if (logStream != null) {
    try {
      await logStream.close();
    } catch {
      // Ignore errors
    }
    logStream = null;
  }

  // Remove signal handlers to prevent accumulation in tests
  if (signalHandler != null) {
    process.removeListener("SIGTERM", signalHandler);
    process.removeListener("SIGINT", signalHandler);
    signalHandler = null;
  }

  // Reset shutdown flag for next run (important for tests)
  isShuttingDown = false;

  if (exitProcess) {
    process.exit(0);
  }
};

/**
 * Main watch function
 *
 * @param args - Configuration arguments
 * @param args.agent - Agent to watch (default: claude-code)
 * @param args.daemon - Whether to run as daemon
 */
export const watchMain = async (args?: {
  agent?: string | null;
  daemon?: boolean | null;
}): Promise<void> => {
  const agent = args?.agent ?? "claude-code";
  const daemon = args?.daemon ?? false;

  // Reset shutdown flag
  isShuttingDown = false;

  // Check if already running
  if (await isWatchRunning()) {
    warn({ message: "Watch daemon is already running" });
    return;
  }

  const pidFile = getWatchPidFile();
  const logFile = getWatchLogFile();

  // Ensure directories exist
  await fs.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.mkdir(path.dirname(logFile), { recursive: true });

  // Write PID file
  await fs.writeFile(pidFile, process.pid.toString(), "utf-8");

  // Set up log file for daemon mode
  if (daemon) {
    logStream = await fs.open(logFile, "a");
  }

  await log(`Watch daemon started (PID: ${process.pid})`);
  await log(`Watching for ${agent} sessions`);

  // Set up signal handlers for graceful shutdown (only exit in production)
  signalHandler = (): void => {
    void cleanupWatch({ exitProcess: true });
  };

  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);

  // Start the watcher
  const watchDir = getClaudeProjectsDir();

  // Check if Claude projects directory exists
  try {
    await fs.access(watchDir);
  } catch {
    await log(`Claude Code projects directory not found: ${watchDir}`);
    await log("Will watch for directory creation...");
  }

  createWatcher({
    watchDir,
    onEvent: (event) => {
      void handleFileEvent({ filePath: event.filePath, agent });
    },
  });

  // Wait for watcher to be ready
  await waitForWatcherReady();

  await log(`Watching directory: ${watchDir}`);

  // Keep the process running in daemon mode
  if (daemon) {
    // In daemon mode, just keep running until stopped
    // Don't block - let the event loop continue
  }
};

/**
 * Stop the watch daemon
 *
 * @param args - Configuration arguments
 * @param args.quiet - Suppress output
 */
export const watchStopMain = async (args?: {
  quiet?: boolean | null;
}): Promise<void> => {
  const quiet = args?.quiet ?? false;

  const pidFile = getWatchPidFile();

  // First, try to clean up locally (for same-process tests)
  await cleanupWatch({ exitProcess: false });

  try {
    const pidContent = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(pidContent.trim(), 10);

    if (isNaN(pid)) {
      if (!quiet) {
        warn({ message: "Invalid PID file" });
      }
      return;
    }

    // Only try to kill if it's a different process
    if (pid !== process.pid) {
      // Send SIGTERM to the process
      try {
        process.kill(pid, "SIGTERM");

        // Wait a bit for the process to exit
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Clean up PID file if process exited
        try {
          process.kill(pid, 0);
          // Process still running, wait a bit more
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // Process exited
        }

        if (!quiet) {
          success({ message: "Watch daemon stopped" });
        }
      } catch {
        if (!quiet) {
          warn({ message: "Watch daemon is not running" });
        }
      }
    } else if (!quiet) {
      // Same process, already cleaned up
      success({ message: "Watch daemon stopped" });
    }

    // Remove PID file
    try {
      await fs.unlink(pidFile);
    } catch {
      // Ignore errors
    }
  } catch {
    if (!quiet) {
      info({ message: "No watch daemon running" });
    }
  }
};
