/**
 * Tests for the watch command.
 *
 * Transcript upload to registrars was retired, so `watch` must never send
 * transcripts anywhere and must not leave a daemon running.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import {
  WATCH_RETIRED_MESSAGE,
  watchMain,
  watchStopMain,
} from "@/cli/commands/watch/watch.js";
import { saveTestingConfig } from "@/cli/test-utils/config.js";

const SESSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const isProcessAlive = (args: { pid: number }): boolean => {
  const { pid } = args;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForExit = async (args: { child: ChildProcess }): Promise<void> => {
  const { child } = args;
  if (child.exitCode != null || child.signalCode != null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

/**
 * Start a long-lived process. With `asWatchDaemon`, its command line matches
 * the daemon that older versions spawned (`... watch --agent <a> --_background`).
 *
 * @param args - Configuration arguments
 * @param args.asWatchDaemon - Whether to mimic a legacy watch daemon
 *
 * @returns The spawned child process
 */
const spawnLongLivedProcess = (args: {
  asWatchDaemon: boolean;
}): ChildProcess => {
  const { asWatchDaemon } = args;
  const extraArgs = asWatchDaemon
    ? ["watch", "--agent", "claude-code", "--_background"]
    : [];
  return spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", ...extraArgs],
    { stdio: "ignore" },
  );
};

const fileExists = async (args: { filePath: string }): Promise<boolean> => {
  return fs
    .stat(args.filePath)
    .then(() => true)
    .catch(() => false);
};

describe("watch command", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let pidFile: string;
  let logFile: string;
  let requestedUrls: Array<string>;
  let children: Array<ChildProcess>;

  const writePidFile = async (args: { content: string }): Promise<void> => {
    await fs.mkdir(path.dirname(pidFile), { recursive: true });
    await fs.writeFile(pidFile, args.content, "utf-8");
  };

  const startProcess = (args: { asWatchDaemon: boolean }): ChildProcess => {
    const child = spawnLongLivedProcess(args);
    children.push(child);
    return child;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-cmd-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    vi.mocked(os.homedir).mockReturnValue(tempDir);
    pidFile = path.join(tempDir, ".nori", "watch.pid");
    logFile = path.join(tempDir, ".nori", "logs", "watch.log");
    children = [];

    requestedUrls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  });

  afterEach(async () => {
    for (const child of children) {
      if (child.pid != null && isProcessAlive({ pid: child.pid })) {
        child.kill("SIGKILL");
      }
    }
    vi.unstubAllGlobals();
    if (originalHome != null) {
      process.env.HOME = originalHome;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("watch", () => {
    test("never sends transcripts to the registry", async () => {
      // A logged-in user with a configured transcript destination and a
      // completed session transcript in both the agent's directory and the
      // legacy upload queue.
      await saveTestingConfig({
        username: "user@example.com",
        idToken: "test-id-token",
        idTokenExpiresAt: Date.now() + 60 * 60 * 1000,
        organizationUrl: "https://myorg.noriskillsets.dev",
        organizations: ["myorg"],
        transcriptDestination: "myorg",
        garbageCollectTranscripts: "disabled",
        installDir: tempDir,
      });
      const transcriptLine =
        JSON.stringify({ sessionId: SESSION_ID, type: "user" }) + "\n";
      const oldTime = new Date(Date.now() - 5 * 60 * 1000);
      for (const dir of [
        path.join(tempDir, ".claude", "projects", "my-project"),
        path.join(tempDir, ".nori", "transcripts", "claude-code", "my-project"),
      ]) {
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, `${SESSION_ID}.jsonl`);
        await fs.writeFile(file, transcriptLine);
        await fs.utimes(file, oldTime, oldTime);
      }

      await watchMain({ agent: "claude-code" });
      await watchMain({ agent: "claude-code", _background: true });
      // Leave time for any scanner or watcher that may have been started.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(requestedUrls).toEqual([]);
    });

    test("tells the user transcript upload was retired and leaves no daemon", async () => {
      const result = await watchMain({ agent: "claude-code" });

      expect(result).toEqual({
        success: true,
        cancelled: false,
        message: WATCH_RETIRED_MESSAGE,
      });
      expect(await fileExists({ filePath: pidFile })).toBe(false);
    });

    test("stops a daemon left running by an older version and says so", async () => {
      const daemon = startProcess({ asWatchDaemon: true });
      const pid = daemon.pid!;
      await writePidFile({ content: String(pid) });

      const result = await watchMain({ agent: "claude-code" });
      await waitForExit({ child: daemon });

      expect(isProcessAlive({ pid })).toBe(false);
      expect(await fileExists({ filePath: pidFile })).toBe(false);
      expect(result.success).toBe(true);
      expect(result.message).toContain(String(pid));
      expect(result.message).toContain(WATCH_RETIRED_MESSAGE);
    });

    test("does not kill an unrelated process whose PID is in a stale PID file", async () => {
      const unrelated = startProcess({ asWatchDaemon: false });
      const pid = unrelated.pid!;
      await writePidFile({ content: String(pid) });

      const result = await watchMain({ agent: "claude-code" });
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(isProcessAlive({ pid })).toBe(true);
      expect(await fileExists({ filePath: pidFile })).toBe(false);
      expect(result.message).toBe(WATCH_RETIRED_MESSAGE);
    });

    test("background mode logs the retirement and exits without registering a daemon", async () => {
      const result = await watchMain({
        agent: "claude-code",
        _background: true,
      });

      expect(result.success).toBe(true);
      expect(await fileExists({ filePath: pidFile })).toBe(false);
      expect(await fs.readFile(logFile, "utf-8")).toContain(
        WATCH_RETIRED_MESSAGE,
      );
    });
  });

  describe("watch stop", () => {
    test("stops a running daemon and removes its PID file", async () => {
      const daemon = startProcess({ asWatchDaemon: true });
      const pid = daemon.pid!;
      await writePidFile({ content: String(pid) });

      await watchStopMain({ quiet: true });
      await waitForExit({ child: daemon });

      expect(isProcessAlive({ pid })).toBe(false);
      expect(await fileExists({ filePath: pidFile })).toBe(false);
    });

    test("never signals the current process", async () => {
      await writePidFile({ content: String(process.pid) });

      await watchStopMain({ quiet: true });

      expect(isProcessAlive({ pid: process.pid })).toBe(true);
      expect(await fileExists({ filePath: pidFile })).toBe(false);
    });

    test.each([["not-a-pid"], ["999999999"]])(
      "clears an unusable PID file (%s) without failing",
      async (content) => {
        await writePidFile({ content });

        await watchStopMain({ quiet: true });

        expect(await fileExists({ filePath: pidFile })).toBe(false);
      },
    );

    test("succeeds when no daemon is running", async () => {
      await watchStopMain({ quiet: true });

      expect(await fileExists({ filePath: pidFile })).toBe(false);
    });
  });
});
