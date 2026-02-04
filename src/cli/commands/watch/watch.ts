/**
 * Watch Command
 *
 * Monitors Claude Code sessions and saves transcripts to ~/.nori/transcripts/
 * Runs as a background daemon with PID file management.
 */

import { spawn } from "child_process";
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
import { loadConfig, saveConfig } from "@/cli/config.js";
import { info, success, warn } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";

/**
 * Debounce window in milliseconds for file events
 */
const DEBOUNCE_MS = 500;

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
 * Debounce map for file events
 * Key: file path, Value: last event timestamp
 */
const lastEventTime: Map<string, number> = new Map();

/**
 * Track files currently being uploaded to prevent duplicate uploads
 */
const uploadingFiles: Set<string> = new Set();

/**
 * Watcher for Claude Code projects directory
 */
let projectsWatcher: WatcherInstance | null = null;

/**
 * Watcher for transcript storage directory (.done markers)
 */
let markersWatcher: WatcherInstance | null = null;

/**
 * Current transcript destination org ID
 */
let transcriptOrgId: string | null = null;

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

  // Debounce: skip if we processed this marker recently
  const now = Date.now();
  const lastTime = lastEventTime.get(markerPath);
  if (lastTime != null && now - lastTime < DEBOUNCE_MS) {
    return;
  }
  lastEventTime.set(markerPath, now);

  // Derive transcript path from marker path (.done -> .jsonl)
  const transcriptPath = markerPath.replace(/\.done$/, ".jsonl");

  // Skip if already uploading this file (prevent concurrent uploads)
  if (uploadingFiles.has(transcriptPath)) {
    await log(
      `Skipping duplicate upload (already in progress): ${transcriptPath}`,
    );
    return;
  }

  uploadingFiles.add(transcriptPath);

  try {
    await log(`Marker detected, uploading: ${transcriptPath}`);

    const uploaded = await processTranscriptForUpload({
      transcriptPath,
      markerPath,
      orgId: transcriptOrgId,
    });

    if (uploaded) {
      await log(`Successfully uploaded and cleaned up: ${transcriptPath}`);
    } else {
      await log(`Upload failed: ${transcriptPath}`);
    }
  } finally {
    uploadingFiles.delete(transcriptPath);
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

  // Debounce: skip if we processed this file recently
  const now = Date.now();
  const lastTime = lastEventTime.get(filePath);
  if (lastTime != null && now - lastTime < DEBOUNCE_MS) {
    return;
  }
  lastEventTime.set(filePath, now);

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

  // Stop both watchers
  if (projectsWatcher != null) {
    stopWatcher({ instance: projectsWatcher });
    projectsWatcher = null;
  }
  if (markersWatcher != null) {
    stopWatcher({ instance: markersWatcher });
    markersWatcher = null;
  }

  // Clear debounce and upload tracking
  lastEventTime.clear();
  uploadingFiles.clear();

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

  // Reset shutdown flag and transcript destination for next run (important for tests)
  isShuttingDown = false;
  transcriptOrgId = null;

  if (exitProcess) {
    process.exit(0);
  }
};

/**
 * Select transcript destination organization
 *
 * @param args - Configuration arguments
 * @param args.privateOrgs - List of private orgs the user has access to
 * @param args.currentDestination - Current transcript destination (if any)
 * @param args.forceSelection - Force re-selection even if destination is set
 * @param args.isDaemon - Whether running in daemon mode (no TTY for prompts)
 *
 * @returns Selected org ID or null if no selection possible
 */
const selectTranscriptDestination = async (args: {
  privateOrgs: Array<string>;
  currentDestination?: string | null;
  forceSelection?: boolean | null;
  isDaemon?: boolean | null;
}): Promise<string | null> => {
  const { privateOrgs, currentDestination, forceSelection, isDaemon } = args;

  // If current destination is valid and not forcing re-selection, use it
  if (
    !forceSelection &&
    currentDestination != null &&
    privateOrgs.includes(currentDestination)
  ) {
    return currentDestination;
  }

  // No private orgs - can't upload transcripts
  if (privateOrgs.length === 0) {
    return null;
  }

  // Single org - auto-select
  if (privateOrgs.length === 1) {
    return privateOrgs[0];
  }

  // Multiple orgs in daemon mode - auto-select first with warning
  if (isDaemon) {
    warn({
      message: `Multiple organizations available but running in daemon mode. Using first org: ${privateOrgs[0]}. Run 'nori-skillsets watch --set-destination' interactively to change.`,
    });
    return privateOrgs[0];
  }

  // Multiple orgs - prompt user
  info({ message: "\nSelect organization for transcript uploads:" });
  for (let i = 0; i < privateOrgs.length; i++) {
    info({ message: `  ${i + 1}. ${privateOrgs[i]}` });
  }

  let response: string;
  try {
    response = await promptUser({
      prompt: `Enter number (1-${privateOrgs.length}): `,
    });
  } catch {
    warn({ message: "Unable to prompt for selection, using first org" });
    return privateOrgs[0];
  }

  const choice = parseInt(response.trim(), 10);
  if (isNaN(choice) || choice < 1 || choice > privateOrgs.length) {
    warn({ message: "Invalid selection, using first org" });
    return privateOrgs[0];
  }

  return privateOrgs[choice - 1];
};

/**
 * Spawn the watch daemon as a detached background process
 *
 * @param args - Configuration arguments
 * @param args.agent - Agent to watch
 *
 * @returns The spawned child process PID
 */
const spawnDaemonProcess = async (args: { agent: string }): Promise<number> => {
  const { agent } = args;

  // Get the path to the nori-skillsets executable
  const execPath = process.argv[1];

  // Spawn detached child process with _background flag
  const child = spawn(
    process.execPath,
    [execPath, "watch", "--agent", agent, "--_background"],
    {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env },
    },
  );

  // Unref so parent can exit independently
  child.unref();

  if (child.pid == null) {
    throw new Error("Failed to spawn daemon process");
  }

  return child.pid;
};

/**
 * Main watch function
 *
 * @param args - Configuration arguments
 * @param args.agent - Agent to watch (default: claude-code)
 * @param args.daemon - Whether to run as daemon (deprecated, kept for compatibility)
 * @param args.setDestination - Force re-selection of transcript destination
 * @param args._background - Internal flag: run as background daemon (set by spawn)
 */
export const watchMain = async (args?: {
  agent?: string | null;
  daemon?: boolean | null;
  _background?: boolean | null;
  setDestination?: boolean | null;
}): Promise<void> => {
  const agent = args?.agent ?? "claude-code";
  const _background = args?._background ?? false;
  const setDestination = args?.setDestination ?? false;

  const homeDir = process.env.HOME ?? "";
  const installDir = homeDir; // Config is at ~/.nori-config.json (home dir is base)
  const logFile = getWatchLogFile();

  // Check if already running
  if (await isWatchRunning()) {
    warn({ message: "Watch daemon is already running" });
    return;
  }

  // INTERACTIVE MODE: Do setup, then spawn background daemon
  if (!_background) {
    // Load config and handle transcript destination selection (interactive)
    const config = await loadConfig({ installDir });

    // Get user's organizations (filter out "public")
    const userOrgs = config?.auth?.organizations ?? [];
    const privateOrgs = userOrgs.filter((org) => org !== "public");

    // Select transcript destination (interactive - will prompt if needed)
    const selectedOrg = await selectTranscriptDestination({
      privateOrgs,
      currentDestination: config?.transcriptDestination,
      forceSelection: setDestination,
      isDaemon: false, // Always interactive in this mode
    });

    // Save selection if it changed
    if (selectedOrg != null && selectedOrg !== config?.transcriptDestination) {
      await saveConfig({
        username: config?.auth?.username ?? null,
        password: config?.auth?.password ?? null,
        refreshToken: config?.auth?.refreshToken ?? null,
        organizationUrl: config?.auth?.organizationUrl ?? null,
        organizations: config?.auth?.organizations ?? null,
        isAdmin: config?.auth?.isAdmin ?? null,
        sendSessionTranscript: config?.sendSessionTranscript ?? null,
        autoupdate: config?.autoupdate ?? null,
        agents: config?.agents ?? null,
        version: config?.version ?? null,
        transcriptDestination: selectedOrg,
        installDir,
      });
    }

    // Ensure log directory exists before spawning
    await fs.mkdir(path.dirname(logFile), { recursive: true });

    // Spawn the background daemon process
    const pid = await spawnDaemonProcess({ agent });
    success({
      message: `Watch daemon started (PID: ${pid}). Logs: ${logFile}`,
    });

    // Parent process exits here, child continues in background
    return;
  }

  // BACKGROUND MODE: Run the actual daemon (spawned by interactive mode)
  // Reset shutdown flag
  isShuttingDown = false;

  // Load config to get saved transcript destination
  const config = await loadConfig({ installDir });
  transcriptOrgId = config?.transcriptDestination ?? null;

  const pidFile = getWatchPidFile();

  // Ensure directories exist
  await fs.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.mkdir(path.dirname(logFile), { recursive: true });

  // Write PID file
  await fs.writeFile(pidFile, process.pid.toString(), "utf-8");

  // Set up log file for background daemon mode
  // (stdout/stderr are detached, so we must log to file)
  logStream = await fs.open(logFile, "a");

  await log(`Watch daemon started (PID: ${process.pid})`);
  await log(`Watching for ${agent} sessions`);

  // Install transcript upload hook (idempotent)
  try {
    await installTranscriptHook();
    await log("Transcript upload hook installed");
  } catch (err) {
    await log(`Warning: Failed to install transcript hook: ${err}`);
    // Continue anyway - daemon still watches for .done markers
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

  // Also set up watching for the transcript storage directory (for .done markers)
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

  // Process stays running due to active watchers and interval timers
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
