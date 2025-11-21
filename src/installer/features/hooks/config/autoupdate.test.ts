/**
 * Tests for autoupdate hook
 */

import { execSync, spawn } from "child_process";

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock filesystem
vi.mock("fs", () => ({
  appendFileSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  existsSync: vi.fn(),
}));

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

// Stub the __PACKAGE_VERSION__ that gets injected at build time
// During tests, we need to provide this value
vi.stubGlobal("__PACKAGE_VERSION__", "14.1.0");

describe("autoupdate", () => {
  describe("E2E integration tests", () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      vi.resetModules(); // Reset module cache to ensure fresh imports

      // Setup default mocks for path utilities
      // By default, assume config is found in cwd
      const { getInstallDirs } = await import("@/utils/path.js");
      // Mock getInstallDirs to return cwd as the install directory
      vi.mocked(getInstallDirs).mockReturnValue(["/home/user/project"]);

      // Mock existsSync to return true by default (installDir exists)
      const { existsSync } = await import("fs");
      vi.mocked(existsSync).mockReturnValue(true);
    });

    it("should trigger installation when new version is available", async () => {
      // Mock openSync to return fake file descriptor
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Mock getInstalledVersion to return current version
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock execSync to return latest version from npm
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      // Mock spawn to capture the installation call
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadDiskConfig
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log to capture output
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify execSync was called to get latest version
      expect(mockExecSync).toHaveBeenCalledWith(
        "npm view nori-ai version",
        expect.objectContaining({
          encoding: "utf-8",
        }),
      );

      // Verify spawn was called with correct arguments to install new version
      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining([
          "nori-ai@14.2.0",
          "install",
          "--non-interactive",
        ]),
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );

      // Verify child.unref was called
      expect(mockChild.unref).toHaveBeenCalled();

      // Verify user notification was logged
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain("14.1.0"); // current version
      expect(parsed.systemMessage).toContain("14.2.0"); // new version
      expect(parsed.systemMessage).toContain("update available");

      consoleLogSpy.mockRestore();
    });

    it("should not trigger installation when already on latest version", async () => {
      // Mock getInstalledVersion to return current version
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock npm to return same version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadDiskConfig
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify spawn was NOT called
      expect(mockSpawn).not.toHaveBeenCalled();

      // Verify no notification
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should handle missing latest version gracefully", async () => {
      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock execSync to throw (network error)
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockImplementation(() => {
        throw new Error("Network error");
      });

      const mockSpawn = vi.mocked(spawn);

      // Mock loadDiskConfig
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify no installation was triggered
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should handle npm returning empty version gracefully", async () => {
      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock execSync to return empty string
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadDiskConfig
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify no installation was triggered
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should track session start event on every run", async () => {
      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock execSync to return same version (no update needed)
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      // Mock loadDiskConfig to return paid config
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: {
          username: "test@example.com",
          password: "test123",
          organizationUrl: "http://localhost:3000",
        },
        profile: {
          baseProfile: "senior-swe",
        },
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify trackEvent was called with session start
      expect(mockTrackEvent).toHaveBeenCalledWith({
        eventName: "nori_session_started",
        eventParams: {
          installed_version: "14.1.0",
          update_available: false,
          install_type: "paid",
        },
      });
    });

    it("should track session start with update_available=true when update exists", async () => {
      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock execSync to return newer version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      // Mock spawn
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadDiskConfig to return free config
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify trackEvent was called with update_available=true
      expect(mockTrackEvent).toHaveBeenCalledWith({
        eventName: "nori_session_started",
        eventParams: {
          installed_version: "14.1.0",
          update_available: true,
          install_type: "free",
        },
      });

      consoleLogSpy.mockRestore();
    });

    it("should track session start even when npm check fails", async () => {
      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock execSync to throw
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockImplementation(() => {
        throw new Error("Network error");
      });

      // Mock loadDiskConfig to return paid config
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: {
          username: "test@example.com",
          password: "test123",
          organizationUrl: "http://localhost:3000",
        },
        profile: {
          baseProfile: "senior-swe",
        },
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify trackEvent was still called (session tracking should be independent)
      // When npm check fails, we can't determine if update is available, so default to false
      expect(mockTrackEvent).toHaveBeenCalledWith({
        eventName: "nori_session_started",
        eventParams: {
          installed_version: "14.1.0",
          update_available: false,
          install_type: "paid",
        },
      });
    });

    it("should check installed version from file not build constant", async () => {
      // This test verifies the core fix: autoupdate should read version from
      // ~/.nori-installed-version (via getInstalledVersion) instead of using
      // the build-time __PACKAGE_VERSION__ constant.
      //
      // Scenario: Hook file is v14.3.6 but install failed previously,
      // so .nori-installed-version still says "14.0.0"
      // Expected: Autoupdate should trigger for 14.3.6 (file version vs npm)
      // not compare 14.3.6 vs 14.3.6 (build constant vs npm)

      // Mock openSync to return fake file descriptor
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Mock getInstalledVersion to return old version from file
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.0.0");

      // Mock execSync to return latest version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.3.6\n");

      // Mock spawn to verify installation is triggered
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadDiskConfig
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify getInstalledVersion was called
      expect(mockGetInstalledVersion).toHaveBeenCalled();

      // Verify spawn was called to install v14.3.6
      // This proves we're comparing file version (14.0.0) vs npm (14.3.6),
      // not build constant (14.1.0) vs npm (14.3.6)
      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining([
          "nori-ai@14.3.6",
          "install",
          "--non-interactive",
        ]),
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );

      // Verify notification shows correct version transition
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain("14.0.0"); // file version
      expect(parsed.systemMessage).toContain("14.3.6"); // new version

      consoleLogSpy.mockRestore();
    });

    it("should append install output to notifications log", async () => {
      // This test verifies that background install output is logged to
      // ~/.nori-notifications.log for debugging

      // Mock filesystem functions
      const { appendFileSync, openSync } = await import("fs");
      const mockAppendFileSync = vi.mocked(appendFileSync);
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.0.0");

      // Mock execSync to return newer version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.3.6\n");

      // Mock spawn
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadDiskConfig
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify appendFileSync was called to write log header
      expect(mockAppendFileSync).toHaveBeenCalled();
      const appendCall = mockAppendFileSync.mock.calls[0];
      const logPath = appendCall[0];
      const logContent = appendCall[1] as string;

      // Verify log path is correct
      expect(logPath).toContain(".nori-notifications.log");

      // Verify log content includes timestamp, version, and command
      expect(logContent).toContain("Nori Autoupdate");
      expect(logContent).toContain("14.3.6"); // version being installed
      expect(logContent).toContain(
        "npx nori-ai@14.3.6 install --non-interactive",
      );

      // Verify openSync was called for append mode
      expect(mockOpenSync).toHaveBeenCalledWith(
        expect.stringContaining(".nori-notifications.log"),
        "a",
      );

      // Verify spawn was called with stdio redirected to log file descriptor
      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining([
          "nori-ai@14.3.6",
          "install",
          "--non-interactive",
        ]),
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );

      consoleLogSpy.mockRestore();
    });

    it("should use openSync for file descriptor instead of createWriteStream", async () => {
      // Mock openSync to return fake file descriptor
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.0.0");

      // Mock execSync to return newer version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.3.6\n");

      // Mock spawn
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadDiskConfig
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify openSync was called with append flag
      expect(mockOpenSync).toHaveBeenCalledWith(
        expect.stringContaining(".nori-notifications.log"),
        "a",
      );

      // Verify spawn was called with file descriptor, not stream
      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining([
          "nori-ai@14.3.6",
          "install",
          "--non-interactive",
        ]),
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );

      consoleLogSpy.mockRestore();
    });

    it("should find config in parent directory when running from subdirectory", async () => {
      // This test verifies the fix for the bug where autoupdate uses process.cwd()
      // instead of searching upward for the config file.
      //
      // Scenario: Nori installed in /home/user, but Claude Code running from /home/user/foo/bar
      // Expected: Autoupdate finds /home/user/.nori-config.json and uses /home/user/.claude as installDir

      // Mock process.cwd() to return subdirectory
      const originalCwd = process.cwd;
      process.cwd = vi.fn(() => "/home/user/foo/bar");

      // Mock path.ts functions
      const { getInstallDirs } = await import("@/utils/path.js");
      const getInstallDirsSpy = vi.mocked(getInstallDirs);

      // Mock getInstallDirs to return parent directory as closest installation
      // (cwd has no installation, but parent does)
      getInstallDirsSpy.mockReturnValue(["/home/user"]);

      // Mock loadDiskConfig to return config with installDir
      const { loadDiskConfig } = await import("@/installer/config.js");
      const mockLoadDiskConfig = vi.mocked(loadDiskConfig);
      mockLoadDiskConfig.mockResolvedValue({
        auth: null,
        profile: null,
        installDir: "/home/user/.claude",
      });

      // Mock getInstalledVersion
      const { getInstalledVersion } = await import("@/installer/version.js");
      const mockGetInstalledVersion = vi.mocked(getInstalledVersion);
      mockGetInstalledVersion.mockReturnValue("14.1.0");

      // Mock execSync to return newer version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      // Mock spawn
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock openSync
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Mock trackEvent
      const { trackEvent } = await import("@/installer/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Run autoupdate
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify loadDiskConfig was called with the parent directory (where config was found)
      expect(mockLoadDiskConfig).toHaveBeenCalledWith({
        installDir: "/home/user",
      });

      // Verify getInstalledVersion was called with the installDir from config
      expect(mockGetInstalledVersion).toHaveBeenCalledWith({
        installDir: "/home/user/.claude",
      });

      // Verify spawn was called with correct installDir
      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        [
          "nori-ai@14.2.0",
          "install",
          "--non-interactive",
          "--install-dir",
          "/home/user/.claude",
        ],
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );

      // Restore
      process.cwd = originalCwd;
      consoleLogSpy.mockRestore();
      getInstallDirsSpy.mockRestore();
    });
  });
});
