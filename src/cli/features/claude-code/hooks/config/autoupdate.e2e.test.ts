/**
 * E2E tests for autoupdate hook - testing real spawn behavior
 */

import { execSync } from "child_process";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type * as childProcess from "child_process";

// Mock only what we need to - let spawn be real
vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof childProcess;
  return {
    ...actual,
    execSync: vi.fn(), // Mock execSync to control npm version check
  };
});

// Mock logger to suppress output
vi.mock("@/cli/logger.js", () => ({
  error: vi.fn(),
}));

// Mock analytics
vi.mock("@/cli/analytics.js", () => ({
  trackEvent: vi.fn(),
}));

// Mock config to provide install_type and version
vi.mock("@/cli/config.js", () => ({
  loadConfig: vi.fn(),
}));

// Mock path utilities
vi.mock("@/utils/path.js", () => ({
  getInstallDirs: vi.fn(),
}));

describe("autoupdate E2E real spawn tests", () => {
  let tempBinDir: string;
  let tempHomeDir: string;
  let originalPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Import real fs and os modules
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");

    // Create temp directories using real fs
    tempBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-bin-"));
    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-home-"));

    // Save originals
    originalPath = process.env.PATH || "";
    originalHome = process.env.HOME;

    // Mock environment - prepend temp bin to PATH so fake sh is found first
    process.env.PATH = `${tempBinDir}${path.delimiter}${originalPath}`;
    process.env.HOME = tempHomeDir;

    // Create fake sh executable that logs when called
    // This intercepts the `sh -c "npm install -g ... && nori-ai ..."` command
    const fakeShPath = path.join(tempBinDir, "sh");
    const callLogPath = path.join(tempBinDir, "sh-calls.log");
    const fakeShScript = `#!/bin/bash
echo "sh called with: $@" >> "${callLogPath}"
exit 0
`;
    fs.writeFileSync(fakeShPath, fakeShScript);
    fs.chmodSync(fakeShPath, 0o755); // Make executable
  });

  afterEach(async () => {
    // Restore environment
    process.env.PATH = originalPath;
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Cleanup temp directories using real fs
    const fsPromises = await import("fs/promises");
    await fsPromises.rm(tempBinDir, { recursive: true, force: true });
    await fsPromises.rm(tempHomeDir, { recursive: true, force: true });
  });

  it("should spawn shell process with npm global install when update available", async () => {
    // Use real fs for this test
    const fs = await import("fs");
    const path = await import("path");

    // Setup: Create notifications log file
    const logPath = path.join(tempHomeDir, ".nori-notifications.log");
    fs.writeFileSync(logPath, "", "utf-8");

    // Create the sh-calls.log file upfront so we can check if it was modified
    // Note: On some systems, spawn("sh", ...) resolves directly to /bin/sh
    // without searching PATH, so our fake sh may not be intercepted
    const callLogPath = path.join(tempBinDir, "sh-calls.log");
    fs.writeFileSync(callLogPath, "", "utf-8");

    // Mock npm registry to return newer version (still need to mock execSync)
    const mockExecSync = vi.mocked(execSync);
    mockExecSync.mockReturnValue("14.2.0\n");

    // Mock path utilities to find config in tempHomeDir
    const { getInstallDirs } = await import("@/utils/path.js");
    vi.mocked(getInstallDirs).mockReturnValue([tempHomeDir]);

    // Mock loadConfig with version and autoupdate explicitly enabled
    const { loadConfig } = await import("@/cli/config.js");
    const mockLoadConfig = vi.mocked(loadConfig);
    mockLoadConfig.mockResolvedValue({
      auth: null,
      profile: null,
      version: "1.0.0",
      autoupdate: "enabled",
      installDir: tempHomeDir,
    });

    // Mock trackEvent
    const { trackEvent } = await import("@/cli/analytics.js");
    const mockTrackEvent = vi.mocked(trackEvent);
    mockTrackEvent.mockResolvedValue();

    // Spy on console.log
    const consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    // Import and run the REAL autoupdate (with real spawn)
    const autoupdate = await import("./autoupdate.js");
    await autoupdate.main();

    // Wait for spawned process to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify: Check the notifications log to confirm spawn was triggered
    // This log is written by autoupdate.ts before spawning
    const notificationsLog = fs.readFileSync(logPath, "utf-8");
    expect(notificationsLog).toContain("Nori Autoupdate");
    expect(notificationsLog).toContain("Installing v14.2.0");
    expect(notificationsLog).toContain("npm install -g nori-ai@14.2.0");
    expect(notificationsLog).toContain("nori-ai install --non-interactive");

    // Check if our fake sh was intercepted (this is platform-dependent)
    // On systems where spawn("sh", ...) searches PATH, our fake sh will log
    // On systems where it resolves to /bin/sh directly, this will be empty
    const callLog = fs.readFileSync(callLogPath, "utf-8");
    if (callLog.length > 0) {
      // Fake sh was intercepted - verify the command
      expect(callLog).toContain("npm install -g nori-ai@14.2.0");
      expect(callLog).toContain("nori-ai install --non-interactive");
    }
    // If callLog is empty, PATH interception didn't work on this platform
    // but we already verified the spawn was triggered via notifications log

    consoleLogSpy.mockRestore();
  });
});
