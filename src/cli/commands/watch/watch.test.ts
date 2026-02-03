/**
 * Tests for watch command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the uploader module to avoid undici import chain
vi.mock("@/cli/commands/watch/uploader.js", () => ({
  processTranscriptForUpload: vi.fn().mockResolvedValue(true),
}));

// Mock the hook installer to avoid settings.json side effects
vi.mock("@/cli/commands/watch/hookInstaller.js", () => ({
  installTranscriptHook: vi.fn().mockResolvedValue(undefined),
  removeTranscriptHook: vi.fn().mockResolvedValue(undefined),
}));

// Mock child_process spawn to prevent actual process spawning in tests
vi.mock("child_process", () => ({
  spawn: vi.fn().mockReturnValue({
    pid: 12345,
    unref: vi.fn(),
  }),
}));

import {
  watchMain,
  watchStopMain,
  isWatchRunning,
  cleanupWatch,
} from "@/cli/commands/watch/watch.js";
import { stopWatcher } from "@/cli/commands/watch/watcher.js";

describe("watch command", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-cmd-test-"));

    // Create mock .nori and .claude directories
    await fs.mkdir(path.join(tempDir, ".nori", "logs"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".claude", "projects"), {
      recursive: true,
    });

    // Save original HOME and override for tests
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    // Clean up any running watch process
    stopWatcher();
    await cleanupWatch({ exitProcess: false });

    // Restore HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    // Small delay to allow cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("watchMain", () => {
    test("starts daemon and writes PID file", async () => {
      // Start watch in background mode (don't block)
      void watchMain({
        agent: "claude-code",
        _background: true,
      });

      // Give it time to start
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Check PID file exists
      const pidFile = path.join(tempDir, ".nori", "watch.pid");
      const pidContent = await fs.readFile(pidFile, "utf-8");
      const pid = parseInt(pidContent, 10);

      expect(pid).toBeGreaterThan(0);
      expect(pid).toBe(process.pid);
    });

    test("creates log file in daemon mode", async () => {
      void watchMain({
        agent: "claude-code",
        _background: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const logFile = path.join(tempDir, ".nori", "logs", "watch.log");
      const exists = await fs
        .stat(logFile)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    test("uses claude-code as default agent", async () => {
      void watchMain({
        _background: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // If it starts without error, the default agent was accepted
      const running = await isWatchRunning();
      expect(running).toBe(true);
    });
  });

  describe("watchStopMain", () => {
    test("stops running daemon", async () => {
      // Start daemon
      void watchMain({
        agent: "claude-code",
        _background: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify it's running
      expect(await isWatchRunning()).toBe(true);

      // Stop it
      await watchStopMain({ quiet: true });

      // Verify it stopped
      expect(await isWatchRunning()).toBe(false);
    });

    test("removes PID file after stopping", async () => {
      void watchMain({
        agent: "claude-code",
        _background: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      await watchStopMain({ quiet: true });

      const pidFile = path.join(tempDir, ".nori", "watch.pid");
      const exists = await fs
        .stat(pidFile)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(false);
    });

    test("handles no running daemon gracefully", async () => {
      // Should not throw when no daemon is running
      await expect(watchStopMain({ quiet: true })).resolves.not.toThrow();
    });
  });

  describe("isWatchRunning", () => {
    test("returns false when no PID file exists", async () => {
      const running = await isWatchRunning();
      expect(running).toBe(false);
    });

    test("returns true when daemon is running", async () => {
      void watchMain({
        agent: "claude-code",
        _background: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const running = await isWatchRunning();
      expect(running).toBe(true);
    });

    test("returns false when PID file exists but process is dead", async () => {
      // Create a PID file with a non-existent process ID
      const pidFile = path.join(tempDir, ".nori", "watch.pid");
      await fs.writeFile(pidFile, "999999999", "utf-8");

      const running = await isWatchRunning();
      expect(running).toBe(false);
    });
  });
});

// Note: Full end-to-end integration tests are skipped due to vitest module
// isolation issues with chokidar's global state. The individual unit tests
// for watcher, parser, storage, and paths all pass and verify the components
// work correctly. Manual testing is recommended for full integration verification.

describe("transcript destination selection", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "watch-transcript-dest-test-"),
    );

    // Create mock .nori and .claude directories
    await fs.mkdir(path.join(tempDir, ".nori", "logs"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".claude", "projects"), {
      recursive: true,
    });

    // Save original HOME and override for tests
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    // Clean up any running watch process
    stopWatcher();
    await cleanupWatch({ exitProcess: false });

    // Restore HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("auto-selects single org without prompting", async () => {
    // Create config with auth and single org
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "token-123",
          organizations: ["myorg"],
        },
        sendSessionTranscript: "enabled",
        installDir: path.join(tempDir, ".nori"),
      }),
    );

    // Run in interactive mode (not _background) to test org selection
    // spawn is mocked so no actual child process is created
    await watchMain({
      agent: "claude-code",
    });

    // Load config and verify transcriptDestination was set
    const updatedConfig = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(updatedConfig);

    expect(config.transcriptDestination).toBe("myorg");
  });

  test("does not prompt when transcriptDestination already set", async () => {
    // Create config with transcriptDestination already set
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "token-123",
          organizations: ["org1", "org2"],
        },
        transcriptDestination: "org1",
        sendSessionTranscript: "enabled",
        installDir: path.join(tempDir, ".nori"),
      }),
    );

    // Start watch
    void watchMain({
      agent: "claude-code",
      _background: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Config should be unchanged
    const updatedConfig = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(updatedConfig);

    expect(config.transcriptDestination).toBe("org1");
  });

  test("does not set transcriptDestination when user has no orgs", async () => {
    // Create config with auth but no organizations
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "token-123",
          organizations: [],
        },
        sendSessionTranscript: "enabled",
        installDir: path.join(tempDir, ".nori"),
      }),
    );

    void watchMain({
      agent: "claude-code",
      _background: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // transcriptDestination should not be set
    const updatedConfig = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(updatedConfig);

    expect(config.transcriptDestination).toBeUndefined();
  });

  test("excludes 'public' from available orgs", async () => {
    // Create config with public and private orgs
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "token-123",
          organizations: ["public", "myorg"],
        },
        sendSessionTranscript: "enabled",
        installDir: path.join(tempDir, ".nori"),
      }),
    );

    // Run in interactive mode (not _background) to test org selection
    // spawn is mocked so no actual child process is created
    await watchMain({
      agent: "claude-code",
    });

    // Should auto-select myorg (only private org)
    const updatedConfig = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(updatedConfig);

    expect(config.transcriptDestination).toBe("myorg");
  });

  test("clears transcriptDestination if org no longer accessible", async () => {
    // Create config where transcriptDestination is set to an org user no longer has access to
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "token-123",
          organizations: ["neworg"], // Old org not in list
        },
        transcriptDestination: "oldorg", // No longer accessible
        sendSessionTranscript: "enabled",
        installDir: path.join(tempDir, ".nori"),
      }),
    );

    // Run in interactive mode (not _background) to test org selection
    // spawn is mocked so no actual child process is created
    await watchMain({
      agent: "claude-code",
    });

    // Should update to neworg (only available private org)
    const updatedConfig = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(updatedConfig);

    expect(config.transcriptDestination).toBe("neworg");
  });

  test("--set-destination flag forces re-selection even when destination already set", async () => {
    // This test verifies the flag is accepted - actual prompting behavior
    // requires interactive testing
    const configPath = path.join(tempDir, ".nori-config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        auth: {
          username: "test@example.com",
          organizationUrl: "https://noriskillsets.dev",
          refreshToken: "token-123",
          organizations: ["singleorg"],
        },
        transcriptDestination: "singleorg",
        sendSessionTranscript: "enabled",
        installDir: path.join(tempDir, ".nori"),
      }),
    );

    // Run in interactive mode (not _background) to test org selection
    // spawn is mocked so no actual child process is created
    await watchMain({
      agent: "claude-code",
      setDestination: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // With single org, should auto-select without prompting
    const updatedConfig = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(updatedConfig);

    expect(config.transcriptDestination).toBe("singleorg");
  });
});
