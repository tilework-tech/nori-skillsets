/**
 * Watch Command
 *
 * Monitors Claude Code sessions and saves transcripts to ~/.nori/transcripts/
 * Runs as a background daemon with PID file management.
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  installTranscriptHook,
  removeTranscriptHook,
} from "@/cli/commands/watch/hookInstaller.js";
import { extractSessionId } from "@/cli/commands/watch/parser.js";
import {
  getClaudeProjectsDir,
  getTranscriptDir,
  getWatchLogFile,
  getWatchPidFile,
} from "@/cli/commands/watch/paths.js";
import { copyTranscript } from "@/cli/commands/watch/storage.js";
import { processTranscriptForUpload } from "@/cli/commands/watch/uploader.js";
import {
  createWatcher,
  stopWatcher,
  waitForWatcherReady,
  type WatcherInstance,
} from "@/cli/commands/watch/watcher.js";
import { info, success, warn } from "@/cli/logger.js";

/**
 * Default staleness timeout in milliseconds (5 minutes)
 */
const DEFAULT_STALE_TIMEOUT_MS = 5 * 60 * 1000;

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
 * Track last modification time for staleness detection
 * Key: transcript file path, Value: last modification timestamp
 */
const fileLastModified: Map<string, number> = new Map();

/**
 * Interval ID for staleness check
 */
let stalenessCheckInterval: NodeJS.Timeout | null = null;

/**
 * Timeout ID for initial scan
 */
let initialScanTimeout: NodeJS.Timeout | null = null;

/**
 * Watcher for Claude Code projects directory
 */
let projectsWatcher: WatcherInstance | null = null;

/**
 * Watcher for transcript storage directory (.done markers)
 */
let markersWatcher: WatcherInstance | null = null;

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
 * Handle a .done marker file event - trigger immediate upload
 *
 * @param args - Configuration arguments
 * @param args.markerPath - Path to the .done marker file
 */
const handleMarkerEvent = async (args: {
  markerPath: string;
}): Promise<void> => {
  const { markerPath } = args;

  if (isShuttingDown) {
    return;
  }

  // Derive transcript path from marker path (.done -> .jsonl)
  const transcriptPath = markerPath.replace(/\.done$/, ".jsonl");

  await log(`Marker detected, uploading: ${transcriptPath}`);

  const uploaded = await processTranscriptForUpload({
    transcriptPath,
    markerPath,
  });

  if (uploaded) {
    await log(`Successfully uploaded and cleaned up: ${transcriptPath}`);
    // Remove from tracking
    fileLastModified.delete(transcriptPath);
  } else {
    await log(`Upload failed, will retry later: ${transcriptPath}`);
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

    // Track for staleness detection
    const destFile = path.join(destDir, `${sessionId}.jsonl`);
    fileLastModified.set(destFile, Date.now());

    await log(`Copied ${sessionId} from ${projectName}`);
  } catch (err) {
    await log(`Error processing ${filePath}: ${err}`);
  }
};

/**
 * Check for stale transcripts and upload them
 *
 * @param args - Configuration arguments
 * @param args.staleTimeoutMs - Staleness threshold in milliseconds
 */
const checkStaleTranscripts = async (args: {
  staleTimeoutMs: number;
}): Promise<void> => {
  const { staleTimeoutMs } = args;
  const now = Date.now();

  for (const [transcriptPath, lastModified] of fileLastModified.entries()) {
    if (now - lastModified >= staleTimeoutMs) {
      await log(`Stale transcript detected, uploading: ${transcriptPath}`);

      // Check if marker exists
      const markerPath = transcriptPath.replace(/\.jsonl$/, ".done");
      let hasMarker = false;
      try {
        await fs.access(markerPath);
        hasMarker = true;
      } catch {
        // No marker
      }

      const uploaded = await processTranscriptForUpload({
        transcriptPath,
        markerPath: hasMarker ? markerPath : null,
      });

      if (uploaded) {
        await log(`Uploaded stale transcript: ${transcriptPath}`);
        fileLastModified.delete(transcriptPath);
      } else {
        await log(`Failed to upload stale transcript: ${transcriptPath}`);
        // Update timestamp to retry later
        fileLastModified.set(transcriptPath, now);
      }
    }
  }
};

/**
 * Scan transcript directory for existing files to track
 *
 * @param args - Configuration arguments
 * @param args.agent - Agent name
 */
const scanExistingTranscripts = async (args: {
  agent: string;
}): Promise<void> => {
  const { agent } = args;
  const homeDir = process.env.HOME ?? "";
  const transcriptsBaseDir = path.join(homeDir, ".nori", "transcripts", agent);

  try {
    await fs.access(transcriptsBaseDir);
  } catch {
    // Directory doesn't exist - nothing to scan
    return;
  }

  await log(`Scanning existing transcripts in ${transcriptsBaseDir}`);

  try {
    const projects = await fs.readdir(transcriptsBaseDir);

    for (const project of projects) {
      const projectDir = path.join(transcriptsBaseDir, project);
      const stat = await fs.stat(projectDir);

      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(projectDir);

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;

        const filePath = path.join(projectDir, file);
        const fileStat = await fs.stat(filePath);

        // Track with the file's actual modification time
        fileLastModified.set(filePath, fileStat.mtimeMs);
        await log(`Found existing transcript: ${filePath}`);
      }
    }
  } catch (err) {
    await log(`Error scanning transcripts: ${err}`);
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

  // Stop both watchers
  if (projectsWatcher != null) {
    stopWatcher({ instance: projectsWatcher });
    projectsWatcher = null;
  }
  if (markersWatcher != null) {
    stopWatcher({ instance: markersWatcher });
    markersWatcher = null;
  }

  // Clear staleness check interval
  if (stalenessCheckInterval != null) {
    clearInterval(stalenessCheckInterval);
    stalenessCheckInterval = null;
  }

  // Clear initial scan timeout
  if (initialScanTimeout != null) {
    clearTimeout(initialScanTimeout);
    initialScanTimeout = null;
  }

  // Clear file tracking
  fileLastModified.clear();

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
 * @param args.staleTimeoutMs - Staleness timeout in milliseconds (default: 5 minutes)
 */
export const watchMain = async (args?: {
  agent?: string | null;
  daemon?: boolean | null;
  staleTimeoutMs?: number | null;
}): Promise<void> => {
  const agent = args?.agent ?? "claude-code";
  const daemon = args?.daemon ?? false;
  const staleTimeoutMs = args?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;

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

  // Install transcript upload hook (idempotent)
  try {
    await installTranscriptHook();
    await log("Transcript upload hook installed");
  } catch (err) {
    await log(`Warning: Failed to install transcript hook: ${err}`);
    // Continue anyway - manual upload via staleness will still work
  }

  // Set up signal handlers for graceful shutdown (only exit in production)
  signalHandler = (): void => {
    void cleanupWatch({ exitProcess: true });
  };

  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);

  // Start the watcher for Claude Code projects
  const watchDir = getClaudeProjectsDir();

  // Check if Claude projects directory exists
  try {
    await fs.access(watchDir);
  } catch {
    await log(`Claude Code projects directory not found: ${watchDir}`);
    await log("Will watch for directory creation...");
  }

  projectsWatcher = createWatcher({
    watchDir,
    onEvent: (event) => {
      void handleFileEvent({ filePath: event.filePath, agent });
    },
  });

  // Wait for watcher to be ready
  await waitForWatcherReady({ instance: projectsWatcher });

  await log(`Watching directory: ${watchDir}`);

  // Set up staleness check interval (check every minute)
  stalenessCheckInterval = setInterval(() => {
    void checkStaleTranscripts({ staleTimeoutMs });
  }, 60 * 1000);

  // Schedule initial scan after staleTimeoutMs (so existing files have time to be considered stale)
  initialScanTimeout = setTimeout(() => {
    void (async () => {
      await log("Running initial scan for existing transcripts...");
      await scanExistingTranscripts({ agent });
      // Immediately check for stale ones
      await checkStaleTranscripts({ staleTimeoutMs });
    })();
  }, staleTimeoutMs);

  // Also set up watching for the transcript storage directory (for .done markers)
  const homeDir = process.env.HOME ?? "";
  const transcriptStorageDir = path.join(
    homeDir,
    ".nori",
    "transcripts",
    agent,
  );

  // Ensure transcript storage directory exists
  await fs.mkdir(transcriptStorageDir, { recursive: true });

  // Create a second watcher for .done marker files
  markersWatcher = createWatcher({
    watchDir: transcriptStorageDir,
    onEvent: (event) => {
      void handleMarkerEvent({ markerPath: event.filePath });
    },
    fileFilter: (filePath) => filePath.endsWith(".done"),
  });

  // Wait for markers watcher to be ready
  await waitForWatcherReady({ instance: markersWatcher });

  await log(`Also watching transcript directory: ${transcriptStorageDir}`);

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

  // Remove transcript upload hook
  try {
    await removeTranscriptHook();
    if (!quiet) {
      info({ message: "Transcript upload hook removed" });
    }
  } catch {
    // Ignore errors - hook may not exist
  }

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
