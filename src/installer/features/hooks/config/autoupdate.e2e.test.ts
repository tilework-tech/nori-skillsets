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
vi.mock("@/installer/logger.js", () => ({
  error: vi.fn(),
}));

// Mock analytics
vi.mock("@/installer/analytics.js", () => ({
  trackEvent: vi.fn(),
}));

// Mock config to provide install_type
vi.mock("@/installer/config.js", () => ({
  loadDiskConfig: vi.fn(),
}));

// Mock version utilities
vi.mock("@/installer/version.js", () => ({
  getInstalledVersion: vi.fn(),
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

    // Setup: Create version file with old version
    const versionFilePath = path.join(tempHomeDir, ".nori-installed-version");
    fs.writeFileSync(versionFilePath, "1.0.0", "utf-8");

    // Setup: Create notifications log file
    const logPath = path.join(tempHomeDir, ".nori-notifications.log");
    fs.writeFileSync(logPath, "", "utf-8");

    // Mock npm registry to return newer version (still need to mock execSync)
    const mockExecSync = vi.mocked(execSync);
    mockExecSync.mockReturnValue("14.2.0\n");

    // Mock getInstalledVersion to return old version
    const { getInstalledVersion } = await import("@/installer/version.js");
    const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
    mockGetInstalledVersion.mockReturnValue("1.0.0");

    // Mock path utilities to find config in tempHomeDir
    const { getInstallDirs } = await import("@/utils/path.js");
    vi.mocked(getInstallDirs).mockReturnValue([tempHomeDir]);

    // Mock loadDiskConfig
    const { loadDiskConfig } = await import("@/installer/config.js");
    const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
    mockLoadDiskConfig.mockResolvedValue({
      auth: null,
      profile: null,
      installDir: tempHomeDir,
    });

    // Mock trackEvent
    const { trackEvent } = await import("@/installer/analytics.js");
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
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify: Check that fake sh was called with the correct command
    const callLogPath = path.join(tempBinDir, "sh-calls.log");
    const callLog = fs.readFileSync(callLogPath, "utf-8");

    // Verify the shell command contains npm install -g and nori-ai install
    expect(callLog).toContain("npm install -g nori-ai@14.2.0");
    expect(callLog).toContain("nori-ai install --non-interactive");

    consoleLogSpy.mockRestore();
  });
});
