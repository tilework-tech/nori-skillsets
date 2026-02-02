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
 * Collection of active watchers
 */
const activeWatchers: Set<FSWatcher> = new Set();

/**
 * Map of watcher to ready promise
 */
const watcherReadyPromises: Map<FSWatcher, Promise<void>> = new Map();

/**
 * Watcher instance with ready promise
 */
export type WatcherInstance = {
  watcher: FSWatcher;
  ready: Promise<void>;
};

/**
 * Create a file watcher for files matching the filter
 *
 * @param args - Configuration arguments
 * @param args.watchDir - Directory to watch
 * @param args.onEvent - Callback for file events
 * @param args.fileFilter - Optional function to filter files (default: .jsonl files)
 *
 * @returns The watcher instance with ready promise
 */
export const createWatcher = (args: {
  watchDir: string;
  onEvent: (event: WatcherEvents) => void;
  fileFilter?: ((filePath: string) => boolean) | null;
}): WatcherInstance => {
  const { watchDir, onEvent, fileFilter } = args;
  const filter =
    fileFilter ?? ((filePath: string) => filePath.endsWith(".jsonl"));

  // Create new watcher
  // Use polling for reliability (native fsevents can be flaky in temp dirs)
  const watcher = chokidar.watch(watchDir, {
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
  const ready = new Promise<void>((resolve) => {
    watcher.on("ready", () => {
      resolve();
    });
  });

  // Set up event handlers
  watcher.on("add", (filePath) => {
    if (filter(filePath)) {
      onEvent({ type: "add", filePath });
    }
  });

  watcher.on("change", (filePath) => {
    if (filter(filePath)) {
      onEvent({ type: "change", filePath });
    }
  });

  watcher.on("error", (error) => {
    console.error("Watcher error:", error);
  });

  // Track watcher
  activeWatchers.add(watcher);
  watcherReadyPromises.set(watcher, ready);

  return { watcher, ready };
};

/**
 * Wait for a specific watcher to be ready
 *
 * @param args - Configuration arguments
 * @param args.instance - The watcher instance to wait for
 */
export const waitForWatcherReady = async (args?: {
  instance?: WatcherInstance | null;
}): Promise<void> => {
  const instance = args?.instance;
  if (instance != null) {
    await instance.ready;
  }
};

/**
 * Stop a specific watcher or all watchers
 *
 * @param args - Configuration arguments
 * @param args.instance - Optional specific watcher to stop (stops all if not provided)
 */
export const stopWatcher = (args?: {
  instance?: WatcherInstance | null;
}): void => {
  const instance = args?.instance;

  if (instance != null) {
    // Stop specific watcher
    void instance.watcher.close();
    activeWatchers.delete(instance.watcher);
    watcherReadyPromises.delete(instance.watcher);
  } else {
    // Stop all watchers
    for (const watcher of activeWatchers) {
      void watcher.close();
    }
    activeWatchers.clear();
    watcherReadyPromises.clear();
  }
};

/**
 * Check if any watcher is active
 *
 * @returns True if at least one watcher is running, false otherwise
 */
export const isWatcherActive = (): boolean => {
  return activeWatchers.size > 0;
};
