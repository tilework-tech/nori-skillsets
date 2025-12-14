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
  openSync: vi.fn(),
  closeSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock logger to suppress output
vi.mock("@/cli/logger.js", () => ({
  debug: vi.fn(),
  error: vi.fn(),
  LOG_FILE: "/tmp/nori.log",
}));

// Mock analytics
vi.mock("@/cli/analytics.js", () => ({
  trackEvent: vi.fn(),
}));

// Mock config to provide install_type
vi.mock("@/cli/config.js", () => ({
  loadConfig: vi.fn(),
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

      // Version is now read from config (set below in mockLoadConfig)

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

      // Mock loadConfig with version and autoupdate explicitly enabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        autoupdate: "enabled",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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

      // Verify spawn was called with shell command to install globally then run install
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", expect.stringContaining("npm install -g nori-ai@14.2.0")],
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );
      // Also verify the command includes running nori-ai install
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[1][1]).toContain("nori-ai install --non-interactive");

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
      // Mock npm to return same version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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
      // Mock execSync to throw (network error)
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockImplementation(() => {
        throw new Error("Network error");
      });

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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
      // Mock execSync to return empty string
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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
      // Mock execSync to return same version (no update needed)
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      // Mock loadConfig to return paid config with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: {
          username: "test@example.com",
          password: "test123",
          organizationUrl: "http://localhost:3000",
        },
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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
      // Mock execSync to return newer version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      // Mock spawn
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadConfig to return free config with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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
      // Mock execSync to throw
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockImplementation(() => {
        throw new Error("Network error");
      });

      // Mock loadConfig to return paid config with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: {
          username: "test@example.com",
          password: "test123",
          organizationUrl: "http://localhost:3000",
        },
        agents: {
          "claude-code": { profile: { baseProfile: "senior-swe" } },
        },
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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

    it("should check installed version from config not build constant", async () => {
      // This test verifies the core fix: autoupdate should read version from
      // config.version instead of using the build-time __PACKAGE_VERSION__ constant.
      //
      // Scenario: Hook file is v14.3.6 but install failed previously,
      // so config.version still says "14.0.0"
      // Expected: Autoupdate should trigger for 14.3.6 (config version vs npm)
      // not compare 14.3.6 vs 14.3.6 (build constant vs npm)

      // Mock openSync to return fake file descriptor
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

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

      // Mock loadConfig with old version 14.0.0 and autoupdate explicitly enabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.0.0",
        autoupdate: "enabled",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify spawn was called to install v14.3.6
      // This proves we're comparing file version (14.0.0) vs npm (14.3.6),
      // not build constant (14.1.0) vs npm (14.3.6)
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", expect.stringContaining("npm install -g nori-ai@14.3.6")],
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );
      // Also verify the command includes running nori-ai install
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[1][1]).toContain("nori-ai install --non-interactive");

      // Verify notification shows correct version transition
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain("14.0.0"); // file version
      expect(parsed.systemMessage).toContain("14.3.6"); // new version

      consoleLogSpy.mockRestore();
    });

    it("should log install output via Winston debug", async () => {
      // This test verifies that background install output is logged via
      // Winston debug() for debugging

      // Mock filesystem functions
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Version "14.0.0" is read from config

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

      // Mock loadConfig with version and autoupdate explicitly enabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.0.0",
        autoupdate: "enabled",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify debug() was called to write log header
      const { debug } = await import("@/cli/logger.js");
      const mockDebug = vi.mocked(debug);
      expect(mockDebug).toHaveBeenCalled();
      const debugCall = mockDebug.mock.calls[0];
      const logContent = debugCall[0].message;

      // Verify log content includes timestamp, version, and command
      expect(logContent).toContain("Nori Autoupdate");
      expect(logContent).toContain("14.3.6"); // version being installed
      expect(logContent).toContain("npm install -g nori-ai@14.3.6");
      expect(logContent).toContain("nori-ai install --non-interactive");

      // Verify openSync was called for append mode (still needed for spawn stdio)
      expect(mockOpenSync).toHaveBeenCalledWith("/tmp/nori.log", "a");

      // Verify spawn was called with stdio redirected to log file descriptor
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", expect.stringContaining("npm install -g nori-ai@14.3.6")],
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

      // Mock loadConfig with version and autoupdate explicitly enabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.0.0",
        autoupdate: "enabled",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
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
      expect(mockOpenSync).toHaveBeenCalledWith("/tmp/nori.log", "a");

      // Verify spawn was called with file descriptor, not stream
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", expect.stringContaining("npm install -g nori-ai@14.3.6")],
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

      // Mock loadConfig to return config with installDir, version and autoupdate enabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        autoupdate: "enabled",
        installDir: "/home/user/.claude",
      });

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
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Run autoupdate
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify loadConfig was called with the parent directory (where config was found)
      expect(mockLoadConfig).toHaveBeenCalledWith({
        installDir: "/home/user",
      });

      // Verify version was read from config (no separate getInstalledVersion call needed)

      // Verify spawn was called with correct installDir
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        [
          "-c",
          expect.stringMatching(
            /npm install -g nori-ai@14\.2\.0 && nori-ai install --non-interactive --install-dir \/home\/user\/\.claude/,
          ),
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

    it("should NOT trigger installation when installed version is greater than npm version", async () => {
      // This test verifies downgrade prevention: if local has v14.2.0 and npm has v14.1.0,
      // autoupdate should NOT install the older version.

      // Mock npm to return older version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig with newer version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.2.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify spawn was NOT called (no downgrade)
      expect(mockSpawn).not.toHaveBeenCalled();

      // Verify no notification
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should NOT update when local nightly is newer than npm stable", async () => {
      // This test verifies nightly build scenario: local v14.2.0-nightly.20250120 is
      // semantically greater than npm v14.1.0, so no update should occur.

      // Version "14.2.0-nightly.20250120" is read from config

      // Mock npm to return stable version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig with nightly version that is newer than npm stable
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.2.0-nightly.20250120",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify spawn was NOT called (nightly is newer)
      expect(mockSpawn).not.toHaveBeenCalled();

      // Verify no notification
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should update when npm stable is newer than local nightly", async () => {
      // This test verifies upgrade from nightly: local v14.1.0-nightly.20250120 is
      // semantically less than npm v14.1.0, so update should occur.

      // Mock openSync to return fake file descriptor
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Version "14.1.0-nightly.20250120" is read from config

      // Mock npm to return stable version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      // Mock spawn to capture the installation call
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadConfig with nightly version that is older than npm stable, autoupdate explicitly enabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0-nightly.20250120",
        autoupdate: "enabled",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify spawn WAS called to upgrade to stable
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", expect.stringContaining("npm install -g nori-ai@14.1.0")],
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );

      // Verify notification
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain("14.1.0-nightly.20250120");
      expect(parsed.systemMessage).toContain("14.1.0");

      consoleLogSpy.mockRestore();
    });

    it("should handle invalid version strings gracefully", async () => {
      // This test verifies that malformed versions from npm are handled gracefully
      // without crashing or triggering an update.

      // Version is now read from config (set below in mockLoadConfig)

      // Mock npm to return invalid version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("not-a-valid-version\n");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify spawn was NOT called (invalid version)
      expect(mockSpawn).not.toHaveBeenCalled();

      // Verify no notification
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should NOT trigger installation when autoupdate config is disabled", async () => {
      // Version is now read from config (set below in mockLoadConfig)

      // Mock execSync to return newer version available
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig with autoupdate disabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        autoupdate: "disabled",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify spawn was NOT called (autoupdate disabled)
      expect(mockSpawn).not.toHaveBeenCalled();

      // Verify user was notified about available update
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain("14.2.0"); // new version
      expect(parsed.systemMessage).toContain("14.1.0"); // current version
      expect(parsed.systemMessage).toContain("Autoupdate is disabled");

      consoleLogSpy.mockRestore();
    });

    it("should trigger installation when autoupdate config is enabled", async () => {
      // Mock openSync to return fake file descriptor
      const { openSync } = await import("fs");
      const mockOpenSync = vi.mocked(openSync);
      mockOpenSync.mockReturnValue(3 as any);

      // Version is now read from config (set below in mockLoadConfig)

      // Mock execSync to return newer version available
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      // Mock spawn to capture the installation call
      const mockSpawn = vi.mocked(spawn);
      const mockChild = {
        unref: vi.fn(),
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockChild as any);

      // Mock loadConfig with autoupdate enabled
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        autoupdate: "enabled",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify spawn WAS called with shell command (autoupdate enabled)
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", expect.stringContaining("npm install -g nori-ai@14.2.0")],
        {
          detached: true,
          stdio: ["ignore", 3, 3],
        },
      );
      // Also verify the command includes running nori-ai install
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[1][1]).toContain("nori-ai install --non-interactive");

      // Verify notification was about installing, not just available
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain("Installing in background");

      consoleLogSpy.mockRestore();
    });

    it("should NOT trigger installation when autoupdate config is not set (defaults to disabled)", async () => {
      // Version is now read from config (set below in mockLoadConfig)

      // Mock execSync to return newer version available
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      const mockSpawn = vi.mocked(spawn);

      // Mock loadConfig WITHOUT autoupdate field (should default to disabled)
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock trackEvent
      const { trackEvent } = await import("@/cli/analytics.js");
      const mockTrackEvent = vi.mocked(trackEvent);
      mockTrackEvent.mockResolvedValue();

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify spawn was NOT called (autoupdate defaults to disabled)
      expect(mockSpawn).not.toHaveBeenCalled();

      // Verify user was notified about available update
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain("14.2.0"); // new version
      expect(parsed.systemMessage).toContain("14.1.0"); // current version
      expect(parsed.systemMessage).toContain("Autoupdate is disabled");

      consoleLogSpy.mockRestore();
    });
  });
});
