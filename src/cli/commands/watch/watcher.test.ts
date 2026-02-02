/**
 * Tests for watch command file watcher
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  createWatcher,
  stopWatcher,
  isWatcherActive,
  waitForWatcherReady,
  type WatcherEvents,
  type WatcherInstance,
} from "@/cli/commands/watch/watcher.js";

/**
 * Wait for a condition to be true, with timeout
 *
 * @param condition - Function that returns true when condition is met
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 */
const waitFor = async (
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe("createWatcher", () => {
  let tempDir: string;
  let watcherInstance: WatcherInstance | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watcher-test-"));
    stopWatcher(); // Ensure clean state
  });

  afterEach(async () => {
    if (watcherInstance != null) {
      stopWatcher({ instance: watcherInstance });
      watcherInstance = null;
    }
    stopWatcher(); // Clean up any remaining watchers
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("emits add event when new JSONL file is created", async () => {
    const events: Array<WatcherEvents> = [];

    watcherInstance = createWatcher({
      watchDir: tempDir,
      onEvent: (event) => events.push(event),
    });

    // Wait for watcher to be ready
    await waitForWatcherReady({ instance: watcherInstance });

    // Create a new JSONL file
    const testFile = path.join(tempDir, "test.jsonl");
    await fs.writeFile(testFile, '{"test": true}', "utf-8");

    // Wait for event
    await waitFor(() => events.some((e) => e.type === "add"));

    const addEvent = events.find((e) => e.type === "add");
    expect(addEvent).toBeDefined();
    expect(addEvent?.filePath).toBe(testFile);
  });

  test("emits change event when JSONL file is modified", async () => {
    // Create file before starting watcher
    const testFile = path.join(tempDir, "existing.jsonl");
    await fs.writeFile(testFile, '{"initial": true}', "utf-8");

    const events: Array<WatcherEvents> = [];

    watcherInstance = createWatcher({
      watchDir: tempDir,
      onEvent: (event) => events.push(event),
    });

    // Wait for watcher to be ready
    await waitForWatcherReady({ instance: watcherInstance });

    // Small delay to ensure file is indexed
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Modify the file
    await fs.writeFile(testFile, '{"modified": true}', "utf-8");

    // Wait for event
    await waitFor(() => events.some((e) => e.type === "change"));

    const changeEvent = events.find((e) => e.type === "change");
    expect(changeEvent).toBeDefined();
    expect(changeEvent?.filePath).toBe(testFile);
  });

  test("ignores non-JSONL files", async () => {
    const events: Array<WatcherEvents> = [];

    watcherInstance = createWatcher({
      watchDir: tempDir,
      onEvent: (event) => events.push(event),
    });

    // Wait for watcher to be ready
    await waitForWatcherReady({ instance: watcherInstance });

    // Create a non-JSONL file
    const testFile = path.join(tempDir, "test.txt");
    await fs.writeFile(testFile, "hello", "utf-8");

    // Wait to ensure no event is emitted
    await new Promise((resolve) => setTimeout(resolve, 500));

    const jsonlEvents = events.filter((e) => e.filePath.endsWith(".jsonl"));
    expect(jsonlEvents.length).toBe(0);
  });

  test("watches nested directories", async () => {
    const nestedDir = path.join(tempDir, "nested", "project");
    await fs.mkdir(nestedDir, { recursive: true });

    const events: Array<WatcherEvents> = [];

    watcherInstance = createWatcher({
      watchDir: tempDir,
      onEvent: (event) => events.push(event),
    });

    // Wait for watcher to be ready
    await waitForWatcherReady({ instance: watcherInstance });

    // Create a JSONL file in nested directory
    const testFile = path.join(nestedDir, "session.jsonl");
    await fs.writeFile(testFile, '{"nested": true}', "utf-8");

    // Wait for event
    await waitFor(() =>
      events.some((e) => e.type === "add" && e.filePath === testFile),
    );

    const addEvent = events.find(
      (e) => e.type === "add" && e.filePath === testFile,
    );
    expect(addEvent).toBeDefined();
  });

  test("stopWatcher stops the watcher", async () => {
    const events: Array<WatcherEvents> = [];

    watcherInstance = createWatcher({
      watchDir: tempDir,
      onEvent: (event) => events.push(event),
    });

    // Wait for watcher to be ready
    await waitForWatcherReady({ instance: watcherInstance });

    expect(isWatcherActive()).toBe(true);

    // Stop the watcher
    stopWatcher({ instance: watcherInstance });
    watcherInstance = null;

    expect(isWatcherActive()).toBe(false);

    // Create a file after stopping
    const testFile = path.join(tempDir, "after-stop.jsonl");
    await fs.writeFile(testFile, '{"stopped": true}', "utf-8");

    // Wait to ensure no event is emitted
    await new Promise((resolve) => setTimeout(resolve, 500));

    const afterStopEvent = events.find((e) => e.filePath === testFile);
    expect(afterStopEvent).toBeUndefined();
  });

  test("handles watch directory not existing initially", async () => {
    const nonExistentDir = path.join(tempDir, "does-not-exist");

    // Should not throw
    watcherInstance = createWatcher({
      watchDir: nonExistentDir,
      onEvent: (_event) => {
        // No-op for testing
      },
    });

    expect(watcherInstance).toBeDefined();
  });
});
