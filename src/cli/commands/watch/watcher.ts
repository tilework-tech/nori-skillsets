/**
 * File watcher for watch command
 *
 * Uses chokidar to monitor Claude Code project directories for JSONL changes.
 */

import chokidar from "chokidar";

import type { FSWatcher } from "chokidar";

/**
 * Event types emitted by the watcher
 */
export type WatcherEvents = {
  type: "add" | "change";
  filePath: string;
};

/**
 * Global watcher instance
 */
let watcher: FSWatcher | null = null;

/**
 * Promise that resolves when watcher is ready
 */
let watcherReady: Promise<void> | null = null;

/**
 * Create a file watcher for JSONL files
 *
 * @param args - Configuration arguments
 * @param args.watchDir - Directory to watch
 * @param args.onEvent - Callback for file events
 *
 * @returns The watcher instance
 */
export const createWatcher = (args: {
  watchDir: string;
  onEvent: (event: WatcherEvents) => void;
}): FSWatcher => {
  const { watchDir, onEvent } = args;

  // Stop any existing watcher
  if (watcher != null) {
    void watcher.close();
    watcher = null;
    watcherReady = null;
  }

  // Create new watcher
  // Use polling for reliability (native fsevents can be flaky in temp dirs)
  watcher = chokidar.watch(watchDir, {
    persistent: true,
    ignoreInitial: true, // Don't emit events for existing files
    followSymlinks: true,
    depth: 10,
    usePolling: true, // More reliable across platforms
    interval: 100,
    binaryInterval: 100,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  // Create ready promise
  watcherReady = new Promise((resolve) => {
    watcher!.on("ready", () => {
      resolve();
    });
  });

  // Set up event handlers
  watcher.on("add", (filePath) => {
    if (filePath.endsWith(".jsonl")) {
      onEvent({ type: "add", filePath });
    }
  });

  watcher.on("change", (filePath) => {
    if (filePath.endsWith(".jsonl")) {
      onEvent({ type: "change", filePath });
    }
  });

  watcher.on("error", (error) => {
    console.error("Watcher error:", error);
  });

  return watcher;
};

/**
 * Wait for the watcher to be ready
 */
export const waitForWatcherReady = async (): Promise<void> => {
  if (watcherReady != null) {
    await watcherReady;
  }
};

/**
 * Stop the file watcher
 */
export const stopWatcher = (): void => {
  if (watcher != null) {
    void watcher.close();
    watcher = null;
    watcherReady = null;
  }
};

/**
 * Check if a watcher is active
 *
 * @returns True if a watcher is running, false otherwise
 */
export const isWatcherActive = (): boolean => {
  return watcher != null;
};
