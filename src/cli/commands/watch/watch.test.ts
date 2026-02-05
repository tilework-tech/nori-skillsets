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

// Mock the storage module to track copy calls
vi.mock("@/cli/commands/watch/storage.js", () => ({
  copyTranscript: vi.fn().mockResolvedValue(undefined),
}));

// Mock the parser module to return predictable sessionIds
vi.mock("@/cli/commands/watch/parser.js", () => ({
  extractSessionId: vi.fn().mockResolvedValue("test-session-id"),
}));

// Mock child_process spawn to prevent actual process spawning in tests
vi.mock("child_process", () => ({
  spawn: vi.fn().mockReturnValue({
    pid: 12345,
    unref: vi.fn(),
  }),
}));

import { copyTranscript } from "@/cli/commands/watch/storage.js";
import { processTranscriptForUpload } from "@/cli/commands/watch/uploader.js";
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

    test("kills different-process daemon by reading PID file before cleanup", async () => {
      // This test verifies the bug fix: watchStopMain must read the PID file
      // BEFORE calling cleanupWatch, otherwise cleanupWatch deletes the PID file
      // and the daemon becomes an orphan.

      // Create a PID file with a fake PID (simulating a different process)
      const pidFile = path.join(tempDir, ".nori", "watch.pid");
      const fakePid = 999999;
      await fs.writeFile(pidFile, fakePid.toString(), "utf-8");

      // Track process.kill calls - the SIGTERM call is what kills the daemon
      const killCalls: Array<{ pid: number; signal: string | number }> = [];
      const originalKill = process.kill;
      const killSpy = vi
        .spyOn(process, "kill")
        .mockImplementation((pid: number, signal?: string | number) => {
          killCalls.push({ pid, signal: signal ?? 0 });
          // Simulate ESRCH (no such process) for our fake PID
          if (pid === fakePid) {
            const err = new Error("ESRCH");
            (err as NodeJS.ErrnoException).code = "ESRCH";
            throw err;
          }
          // For other PIDs (like signal 0 checks), use original
          return originalKill.call(process, pid, signal as NodeJS.Signals);
        });

      try {
        await watchStopMain({ quiet: true });

        // The key assertion: we must have attempted to kill the fake PID with SIGTERM
        // This proves we read the PID file before cleanupWatch deleted it
        const sigtermCall = killCalls.find(
          (call) => call.pid === fakePid && call.signal === "SIGTERM",
        );
        expect(sigtermCall).toBeDefined();
      } finally {
        killSpy.mockRestore();
      }
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

describe("event debouncing", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let projectDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-debounce-test-"));

    // Create mock .nori and .claude directories
    await fs.mkdir(path.join(tempDir, ".nori", "logs"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".nori", "transcripts", "claude-code"), {
      recursive: true,
    });
    projectDir = path.join(tempDir, ".claude", "projects", "test-project");
    await fs.mkdir(projectDir, { recursive: true });

    // Save original HOME and override for tests
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    stopWatcher();
    await cleanupWatch({ exitProcess: false });

    if (originalHome) {
      process.env.HOME = originalHome;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("debounces rapid duplicate file events for the same file", async () => {
    // Start the daemon
    void watchMain({
      agent: "claude-code",
      _background: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Create a transcript file - this triggers one copy
    const transcriptFile = path.join(projectDir, "transcript.jsonl");
    await fs.writeFile(
      transcriptFile,
      JSON.stringify({ sessionId: "test-session-id", type: "init" }) + "\n",
    );

    // Wait for first event to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    const copyMock = vi.mocked(copyTranscript);
    const callsAfterFirstWrite = copyMock.mock.calls.length;

    // Modify the file rapidly multiple times within the debounce window
    for (let i = 0; i < 5; i++) {
      await fs.appendFile(
        transcriptFile,
        JSON.stringify({ type: "message", index: i }) + "\n",
      );
      // Very short delay between writes - within debounce window
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Wait for events to be processed
    await new Promise((resolve) => setTimeout(resolve, 300));

    // With debouncing, should have at most 1-2 additional calls
    // (some events may coalesce, but without debouncing we'd see ~5)
    const additionalCalls = copyMock.mock.calls.length - callsAfterFirstWrite;
    expect(additionalCalls).toBeLessThanOrEqual(2);
  });

  test("processes events for different files separately", async () => {
    void watchMain({
      agent: "claude-code",
      _background: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Create two different transcript files
    const transcriptFile1 = path.join(projectDir, "transcript1.jsonl");
    const transcriptFile2 = path.join(projectDir, "transcript2.jsonl");

    await fs.writeFile(
      transcriptFile1,
      JSON.stringify({ sessionId: "session-1", type: "init" }) + "\n",
    );
    await fs.writeFile(
      transcriptFile2,
      JSON.stringify({ sessionId: "session-2", type: "init" }) + "\n",
    );

    // Wait for events to be processed
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Both files should trigger copy events
    const copyMock = vi.mocked(copyTranscript);
    expect(copyMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// Note: The "upload locking" tests were removed as they tested the deprecated
// marker-based upload system. The stale scanner now handles uploads with its
// own locking via the uploadingFiles Set.

describe("stale transcript upload", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let transcriptDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "watch-stale-upload-test-"),
    );

    // Create mock .nori and .claude directories
    await fs.mkdir(path.join(tempDir, ".nori", "logs"), { recursive: true });
    transcriptDir = path.join(
      tempDir,
      ".nori",
      "transcripts",
      "claude-code",
      "test-project",
    );
    await fs.mkdir(transcriptDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, ".claude", "projects"), {
      recursive: true,
    });

    // Save original HOME and override for tests
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    stopWatcher();
    await cleanupWatch({ exitProcess: false });

    if (originalHome) {
      process.env.HOME = originalHome;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("uploads stale transcript that has not been modified recently", async () => {
    const uploadMock = vi.mocked(processTranscriptForUpload);
    uploadMock.mockResolvedValue(true);

    // Create a transcript file with valid UUID sessionId (required by regex)
    const transcriptFile = path.join(transcriptDir, "stale-session.jsonl");
    await fs.writeFile(
      transcriptFile,
      JSON.stringify({
        sessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        type: "init",
      }) + "\n",
    );

    // Make the file appear old (older than stale threshold)
    const oldTime = new Date(Date.now() - 60000); // 60 seconds ago
    await fs.utimes(transcriptFile, oldTime, oldTime);

    // Start the daemon
    void watchMain({
      agent: "claude-code",
      _background: true,
    });

    // Wait for the stale scanner to run (scan interval + processing time)
    // The scan runs every 10 seconds, so we need to wait for at least one scan
    await new Promise((resolve) => setTimeout(resolve, 12000));

    // Should have uploaded the stale transcript
    expect(uploadMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Verify it was called with our transcript
    const uploadedPaths = uploadMock.mock.calls.map(
      (call) => call[0].transcriptPath,
    );
    expect(uploadedPaths).toContain(transcriptFile);
  }, 15000); // Increase timeout for this test

  test("does not upload transcript that was recently modified", async () => {
    const uploadMock = vi.mocked(processTranscriptForUpload);
    uploadMock.mockResolvedValue(true);

    // Start the daemon first
    void watchMain({
      agent: "claude-code",
      _background: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Create a transcript file (will have current mtime - considered "fresh")
    // Use valid UUID sessionId
    const transcriptFile = path.join(transcriptDir, "fresh-session.jsonl");
    await fs.writeFile(
      transcriptFile,
      JSON.stringify({
        sessionId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        type: "init",
      }) + "\n",
    );

    // Wait for a scan cycle
    await new Promise((resolve) => setTimeout(resolve, 12000));

    // Fresh file should NOT be uploaded by the stale scanner
    // (it might be uploaded by other mechanisms, but not due to staleness)
    const staleUploadCalls = uploadMock.mock.calls.filter(
      (call) => call[0].transcriptPath === transcriptFile,
    );

    // The file is fresh, so no stale upload should occur
    expect(staleUploadCalls.length).toBe(0);
  }, 15000);

  test("skips upload when transcript is already in registry with same hash", async () => {
    const uploadMock = vi.mocked(processTranscriptForUpload);
    uploadMock.mockResolvedValue(true);

    // Create a stale transcript file with valid UUID sessionId
    const transcriptFile = path.join(transcriptDir, "already-uploaded.jsonl");
    const content =
      JSON.stringify({
        sessionId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
        type: "init",
      }) + "\n";
    await fs.writeFile(transcriptFile, content);

    // Make the file appear old
    const oldTime = new Date(Date.now() - 60000);
    await fs.utimes(transcriptFile, oldTime, oldTime);

    // Start the daemon
    void watchMain({
      agent: "claude-code",
      _background: true,
    });

    // Wait for first scan to upload
    await new Promise((resolve) => setTimeout(resolve, 12000));

    const firstUploadCount = uploadMock.mock.calls.length;
    expect(firstUploadCount).toBeGreaterThanOrEqual(1);

    // Reset mock to track subsequent calls
    uploadMock.mockClear();

    // Wait for another scan cycle
    await new Promise((resolve) => setTimeout(resolve, 12000));

    // Should NOT upload again - already in registry with same hash
    expect(uploadMock.mock.calls.length).toBe(0);
  }, 30000);
});
