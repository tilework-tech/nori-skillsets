/**
 * Watch Command
 *
 * Monitors Claude Code sessions and saves transcripts to ~/.nori/transcripts/
 * Runs as a background daemon with PID file management.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { extractSessionId } from "@/cli/commands/watch/parser.js";
import {
  getClaudeProjectsDir,
  getTranscriptDir,
  getTranscriptRegistryPath,
  getWatchLogFile,
  getWatchPidFile,
} from "@/cli/commands/watch/paths.js";
import { findStaleTranscripts } from "@/cli/commands/watch/staleScanner.js";
import { copyTranscript } from "@/cli/commands/watch/storage.js";
import { TranscriptRegistry } from "@/cli/commands/watch/transcriptRegistry.js";
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
 * Stale threshold in milliseconds - files not modified for this long are considered stale
 */
const STALE_THRESHOLD_MS = 30000;

/**
 * Expire threshold in milliseconds - files not modified for this long are deleted (24 hours)
 */
const EXPIRE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Scan interval in milliseconds - how often to scan for stale transcripts
 */
const SCAN_INTERVAL_MS = 10000;

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
 * Current transcript destination org ID
 */
let transcriptOrgId: string | null = null;

/**
 * Transcript registry for tracking uploaded transcripts
 */
let registry: TranscriptRegistry | null = null;

/**
 * Interval handle for stale transcript scanner
 */
let scanIntervalHandle: NodeJS.Timeout | null = null;

/**
 * Current transcript storage directory (for stale scanner)
 */
let currentTranscriptDir: string | null = null;

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
 * Compute MD5 hash of file content
 *
 * @param args - Configuration arguments
 * @param args.filePath - Path to the file to hash
 *
 * @returns MD5 hash as hex string, or null if file can't be read
 */
const computeFileHash = async (args: {
  filePath: string;
}): Promise<string | null> => {
  const { filePath } = args;

  try {
    const content = await fs.readFile(filePath);
    return createHash("md5").update(content).digest("hex");
  } catch {
    return null;
  }
};

/**
 * Extract sessionId from transcript file content
 *
 * @param args - Configuration arguments
 * @param args.filePath - Path to the transcript file
 *
 * @returns Session ID or null if not found
 */
const extractSessionIdFromFile = async (args: {
  filePath: string;
}): Promise<string | null> => {
  const { filePath } = args;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    // Match UUID format sessionId
    const regex =
      /"sessionId"\s*:\s*"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/;
    const match = content.match(regex);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

/**
 * Delete expired transcript files
 *
 * @param args - Configuration arguments
 * @param args.expiredFiles - Array of file paths to delete
 */
const deleteExpiredFiles = async (args: {
  expiredFiles: Array<string>;
}): Promise<void> => {
  const { expiredFiles } = args;

  for (const filePath of expiredFiles) {
    if (isShuttingDown) {
      break;
    }

    try {
      await fs.unlink(filePath);
      await log(`Deleted expired transcript: ${filePath}`);
    } catch (err) {
      await log(`Failed to delete expired transcript ${filePath}: ${err}`);
    }
  }
};

/**
 * Scan for stale transcripts and upload them
 */
const scanForStaleTranscripts = async (): Promise<void> => {
  if (isShuttingDown || currentTranscriptDir == null || registry == null) {
    return;
  }

  try {
    const { staleFiles, expiredFiles } = await findStaleTranscripts({
      transcriptDir: currentTranscriptDir,
      staleThresholdMs: STALE_THRESHOLD_MS,
      expireThresholdMs: EXPIRE_THRESHOLD_MS,
    });

    // Delete expired files first
    if (expiredFiles.length > 0) {
      await deleteExpiredFiles({ expiredFiles });
    }

    // Process stale files for upload
    for (const transcriptPath of staleFiles) {
      if (isShuttingDown) {
        break;
      }

      // Skip if already uploading
      if (uploadingFiles.has(transcriptPath)) {
        continue;
      }

      // Extract sessionId
      const sessionId = await extractSessionIdFromFile({
        filePath: transcriptPath,
      });

      if (sessionId == null) {
        await log(`Skipping stale file (no sessionId): ${transcriptPath}`);
        continue;
      }

      // Compute file hash
      const fileHash = await computeFileHash({ filePath: transcriptPath });

      if (fileHash == null) {
        await log(`Skipping stale file (can't hash): ${transcriptPath}`);
        continue;
      }

      // Check if already uploaded with same hash
      if (registry.isUploaded({ sessionId, fileHash })) {
        continue;
      }

      // Upload the transcript
      uploadingFiles.add(transcriptPath);

      try {
        await log(`Uploading stale transcript: ${transcriptPath}`);

        const uploaded = await processTranscriptForUpload({
          transcriptPath,
          orgId: transcriptOrgId,
        });

        if (uploaded) {
          // Mark as uploaded in registry
          // Note: The file may already be deleted by processTranscriptForUpload at this point
          // If marking fails, log warning but don't fail - the upload did succeed
          try {
            registry.markUploaded({ sessionId, fileHash, transcriptPath });
            await log(
              `Successfully uploaded stale transcript: ${transcriptPath}`,
            );
          } catch (registryErr) {
            await log(
              `Warning: Upload succeeded but failed to update registry: ${registryErr}`,
            );
          }
        } else {
          await log(`Failed to upload stale transcript: ${transcriptPath}`);
        }
      } finally {
        uploadingFiles.delete(transcriptPath);
      }
    }
  } catch (err) {
    await log(`Error scanning for stale transcripts: ${err}`);
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

  // Stop the stale scanner interval
  if (scanIntervalHandle != null) {
    clearInterval(scanIntervalHandle);
    scanIntervalHandle = null;
  }

  // Close the registry
  if (registry != null) {
    registry.close();
    registry = null;
  }

  // Stop the watcher
  if (projectsWatcher != null) {
    stopWatcher({ instance: projectsWatcher });
    projectsWatcher = null;
  }

  // Clear debounce and upload tracking
  lastEventTime.clear();
  uploadingFiles.clear();

  // Reset transcript directory
  currentTranscriptDir = null;

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
 * Save transcript destination to config if changed
 *
 * @param args - Configuration arguments
 * @param args.org - Organization ID to save
 * @param args.installDir - Installation directory for config
 */
const saveTranscriptDestination = async (args: {
  org: string;
  installDir: string;
}): Promise<void> => {
  const { org, installDir } = args;
  const config = await loadConfig({ startDir: os.homedir() });
  if (org === config?.transcriptDestination) {
    return;
  }
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
    transcriptDestination: org,
    installDir,
  });
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
 * @param args.experimentalUi - Whether to use the experimental clack-based UI
 */
export const watchMain = async (args?: {
  agent?: string | null;
  daemon?: boolean | null;
  _background?: boolean | null;
  setDestination?: boolean | null;
  experimentalUi?: boolean | null;
}): Promise<void> => {
  const agent = args?.agent ?? "claude-code";
  const _background = args?._background ?? false;
  const setDestination = args?.setDestination ?? false;

  const homeDir = process.env.HOME ?? "";
  const installDir = homeDir; // Config is at ~/.nori-config.json (home dir is base)
  const logFile = getWatchLogFile();

  // Experimental UI flow (interactive only, not in background daemon mode)
  if (args?.experimentalUi && !_background) {
    const { watchFlow } = await import("@/cli/prompts/flows/watch.js");

    await watchFlow({
      forceSelection: setDestination,
      callbacks: {
        onPrepare: async () => {
          const running = await isWatchRunning();
          if (running) {
            await watchStopMain({ quiet: true });
          }

          const config = await loadConfig({ startDir: os.homedir() });
          const userOrgs = config?.auth?.organizations ?? [];
          const privateOrgs = userOrgs.filter((org) => org !== "public");

          return {
            privateOrgs,
            currentDestination: config?.transcriptDestination ?? null,
            isRunning: running,
          };
        },
        onStartDaemon: async ({ org }) => {
          await saveTranscriptDestination({ org, installDir });

          // Ensure log directory exists before spawning
          await fs.mkdir(path.dirname(logFile), { recursive: true });

          try {
            const pid = await spawnDaemonProcess({ agent });
            const transcriptsDir = path.join(
              os.homedir(),
              ".nori",
              "transcripts",
            );
            return { success: true as const, pid, logFile, transcriptsDir };
          } catch (err) {
            return {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      },
    });

    return;
  }

  // Stop any existing daemon before starting a new one
  // This ensures we always run the latest code and prevents duplicate daemons
  if (await isWatchRunning()) {
    info({ message: "Stopping existing watch daemon..." });
    await watchStopMain({ quiet: true });
  }

  // INTERACTIVE MODE: Do setup, then spawn background daemon
  if (!_background) {
    // Load config and handle transcript destination selection (interactive)
    // Use os.homedir() as startDir since watch is home-directory-based
    const config = await loadConfig({ startDir: os.homedir() });

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
    if (selectedOrg != null) {
      await saveTranscriptDestination({ org: selectedOrg, installDir });
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
  // Use os.homedir() as startDir since watch is home-directory-based
  const config = await loadConfig({ startDir: os.homedir() });
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

  // Initialize transcript registry
  const registryPath = getTranscriptRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  registry = new TranscriptRegistry({ dbPath: registryPath });
  await log(`Transcript registry initialized: ${registryPath}`);

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

  // Set up transcript storage directory for stale scanner
  const transcriptStorageDir = path.join(
    homeDir,
    ".nori",
    "transcripts",
    agent,
  );

  // Ensure transcript storage directory exists
  await fs.mkdir(transcriptStorageDir, { recursive: true });

  // Store for stale scanner
  currentTranscriptDir = transcriptStorageDir;

  // Start the stale transcript scanner
  await log(
    `Starting stale transcript scanner (threshold: ${STALE_THRESHOLD_MS}ms, interval: ${SCAN_INTERVAL_MS}ms)`,
  );

  // Run initial scan immediately
  void scanForStaleTranscripts();

  // Then run periodically
  scanIntervalHandle = setInterval(() => {
    void scanForStaleTranscripts();
  }, SCAN_INTERVAL_MS);

  await log(`Transcript storage directory: ${transcriptStorageDir}`);

  // Process stays running due to active watchers and interval timers
};

/**
 * Stop the watch daemon
 *
 * @param args - Configuration arguments
 * @param args.quiet - Suppress output
 * @param args.experimentalUi - Whether to use the experimental clack-based UI
 */
export const watchStopMain = async (args?: {
  quiet?: boolean | null;
  experimentalUi?: boolean | null;
}): Promise<void> => {
  const quiet = args?.quiet ?? false;
  const experimentalUi = args?.experimentalUi ?? false;

  // Resolve output functions based on UI mode
  let logSuccess = (msg: string) => success({ message: msg });
  let logWarn = (msg: string) => warn({ message: msg });
  let logInfo = (msg: string) => info({ message: msg });

  if (experimentalUi) {
    const clack = await import("@clack/prompts");
    logSuccess = (msg: string) => clack.log.success(msg);
    logWarn = (msg: string) => clack.log.warn(msg);
    logInfo = (msg: string) => clack.log.info(msg);
  }

  const pidFile = getWatchPidFile();

  // Read PID file FIRST, before cleanupWatch deletes it
  let daemonPid: number | null = null;
  try {
    const pidContent = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(pidContent.trim(), 10);
    if (!isNaN(pid)) {
      daemonPid = pid;
    }
  } catch {
    // PID file doesn't exist - no daemon running
  }

  // Clean up local state (watchers, log stream, etc.)
  // This also deletes the PID file, which is why we read it first
  await cleanupWatch({ exitProcess: false });

  // If we found a daemon PID and it's a different process, kill it
  if (daemonPid != null && daemonPid !== process.pid) {
    try {
      process.kill(daemonPid, "SIGTERM");

      // Wait a bit for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if process exited
      try {
        process.kill(daemonPid, 0);
        // Process still running, wait a bit more
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // Process exited
      }

      if (!quiet) {
        logSuccess("Watch daemon stopped");
      }
    } catch {
      if (!quiet) {
        logWarn("Watch daemon is not running");
      }
    }
  } else if (daemonPid === process.pid) {
    // Same process, already cleaned up
    if (!quiet) {
      logSuccess("Watch daemon stopped");
    }
  } else if (!quiet) {
    // No PID file found
    logInfo("No watch daemon running");
  }
};
