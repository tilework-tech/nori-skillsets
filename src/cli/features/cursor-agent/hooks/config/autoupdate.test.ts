/**
 * Tests for autoupdate hook (notification-only)
 */

import { execSync } from "child_process";

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock child_process (only execSync needed now)
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock filesystem (only existsSync needed now)
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

// Mock logger to suppress output
vi.mock("@/cli/logger.js", () => ({
  debug: vi.fn(),
  error: vi.fn(),
  LOG_FILE: "/tmp/nori.log",
}));

// Mock analytics from installTracking
vi.mock("@/cli/installTracking.js", () => ({
  buildCLIEventParams: vi.fn().mockResolvedValue({
    tilework_source: "nori-skillsets",
    tilework_session_id: "123456",
    tilework_timestamp: "2025-01-20T00:00:00.000Z",
    tilework_cli_executable_name: "nori-skillsets",
    tilework_cli_installed_version: "1.0.0",
    tilework_cli_install_source: "npm",
    tilework_cli_days_since_install: 0,
    tilework_cli_node_version: "20.0.0",
    tilework_cli_profile: null,
    tilework_cli_install_type: "unauthenticated",
  }),
  getUserId: vi.fn().mockResolvedValue(null),
  sendAnalyticsEvent: vi.fn(),
}));

// Mock config to provide install_type and version
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

    it("should show notification when update is available", async () => {
      // Mock execSync to return latest version from npm
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Spy on console.log to capture output
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify execSync was called to get latest version
      expect(mockExecSync).toHaveBeenCalledWith(
        "npm view nori-skillsets version",
        expect.objectContaining({
          encoding: "utf-8",
        }),
      );

      // Verify user notification was logged with the new notification message
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain(
        "Nori Skillsets v14.2.0 available",
      );
      expect(parsed.systemMessage).toContain("current: v14.1.0");
      expect(parsed.systemMessage).toContain("npm install -g nori-skillsets");
      expect(parsed.systemMessage).toContain("nori-skillsets switch-skillset");

      consoleLogSpy.mockRestore();
    });

    it("should not show notification when already on latest version", async () => {
      // Mock npm to return same version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

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

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify no notification was shown
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should handle npm returning empty version gracefully", async () => {
      // Mock execSync to return empty string
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("");

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify no notification was shown
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should track session start event on every run", async () => {
      // Mock execSync to return same version (no update needed)
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      // Mock loadConfig to return config with auth and version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: {
          username: "test@example.com",
          password: "test123",
          organizationUrl: "http://localhost:3000",
        },
        agents: {
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock sendAnalyticsEvent
      const { sendAnalyticsEvent } = await import("@/cli/installTracking.js");
      const mockSendAnalyticsEvent = vi.mocked(sendAnalyticsEvent);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Wait for async analytics to complete (fire-and-forget runs as microtask)
      await new Promise((resolve) => setImmediate(resolve));

      // Verify sendAnalyticsEvent was called with session start
      expect(mockSendAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "claude_session_started",
          eventParams: expect.objectContaining({
            tilework_cli_update_available: false,
          }),
        }),
      );
    });

    it("should track session start with update_available=true when update exists", async () => {
      // Mock execSync to return newer version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

      // Mock loadConfig to return config with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock sendAnalyticsEvent
      const { sendAnalyticsEvent } = await import("@/cli/installTracking.js");
      const mockSendAnalyticsEvent = vi.mocked(sendAnalyticsEvent);

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Wait for async analytics to complete (fire-and-forget runs as microtask)
      await new Promise((resolve) => setImmediate(resolve));

      // Verify sendAnalyticsEvent was called with update_available=true
      expect(mockSendAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "claude_session_started",
          eventParams: expect.objectContaining({
            tilework_cli_update_available: true,
          }),
        }),
      );

      consoleLogSpy.mockRestore();
    });

    it("should track session start even when npm check fails", async () => {
      // Mock execSync to throw
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockImplementation(() => {
        throw new Error("Network error");
      });

      // Mock loadConfig to return config with auth and version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: {
          username: "test@example.com",
          password: "test123",
          organizationUrl: "http://localhost:3000",
        },
        agents: {
          "cursor-agent": { profile: { baseProfile: "senior-swe" } },
        },
        version: "14.1.0",
        installDir: process.cwd(),
      });

      // Mock sendAnalyticsEvent
      const { sendAnalyticsEvent } = await import("@/cli/installTracking.js");
      const mockSendAnalyticsEvent = vi.mocked(sendAnalyticsEvent);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Wait for async analytics to complete (fire-and-forget runs as microtask)
      await new Promise((resolve) => setImmediate(resolve));

      // Verify sendAnalyticsEvent was still called (session tracking should be independent)
      // When npm check fails, we can't determine if update is available, so default to false
      expect(mockSendAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "claude_session_started",
          eventParams: expect.objectContaining({
            tilework_cli_update_available: false,
          }),
        }),
      );
    });

    it("should show notification with correct versions from config", async () => {
      // This test verifies the core fix: autoupdate should read version from
      // config.version instead of using the build-time __PACKAGE_VERSION__ constant.
      //
      // Scenario: Hook file is v14.3.6 but install failed previously,
      // so config.version still says "14.0.0"
      // Expected: Notification shows config version (14.0.0), not build constant

      // Mock execSync to return latest version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.3.6\n");

      // Mock loadConfig with old version 14.0.0
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.0.0",
        installDir: process.cwd(),
      });

      // Spy on console.log
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      // Import and run main function
      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify notification shows correct version transition
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain(
        "Nori Skillsets v14.3.6 available",
      );
      expect(parsed.systemMessage).toContain("current: v14.0.0");

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

      // Mock loadConfig to return config with installDir and version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: "/home/user/.claude",
      });

      // Mock execSync to return newer version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.2.0\n");

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

      // Verify notification was shown (not an install)
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.systemMessage).toContain(
        "Nori Skillsets v14.2.0 available",
      );
      expect(parsed.systemMessage).toContain("current: v14.1.0");

      // Restore
      process.cwd = originalCwd;
      consoleLogSpy.mockRestore();
      getInstallDirsSpy.mockRestore();
    });

    it("should NOT show notification when installed version is greater than npm version", async () => {
      // This test verifies downgrade prevention: if local has v14.2.0 and npm has v14.1.0,
      // autoupdate should NOT show any notification.

      // Mock npm to return older version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      // Mock loadConfig with newer version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.2.0",
        installDir: process.cwd(),
      });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify no notification
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should NOT show notification when local nightly is newer than npm stable", async () => {
      // This test verifies nightly build scenario: local v14.2.0-nightly.20250120 is
      // semantically greater than npm v14.1.0, so no notification should appear.

      // Mock npm to return stable version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("14.1.0\n");

      // Mock loadConfig with nightly version that is newer than npm stable
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.2.0-nightly.20250120",
        installDir: process.cwd(),
      });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify no notification
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should handle invalid version strings gracefully", async () => {
      // This test verifies that malformed versions from npm are handled gracefully
      // without crashing or showing a notification.

      // Mock npm to return invalid version
      const mockExecSync = vi.mocked(execSync);
      mockExecSync.mockReturnValue("not-a-valid-version\n");

      // Mock loadConfig with version
      const { loadConfig } = await import("@/cli/config.js");
      const mockLoadConfig = vi.mocked(loadConfig);
      mockLoadConfig.mockResolvedValue({
        auth: null,
        agents: null,
        version: "14.1.0",
        installDir: process.cwd(),
      });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);

      const autoupdate = await import("./autoupdate.js");
      await autoupdate.main();

      // Verify version check happened
      expect(mockExecSync).toHaveBeenCalled();

      // Verify no notification (invalid version)
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("should show notification regardless of autoupdate config setting", async () => {
      // Whether autoupdate is "enabled", "disabled", or not set,
      // the notification should always be shown when an update is available.

      const configs = [
        { autoupdate: "enabled" as const },
        { autoupdate: "disabled" as const },
        { autoupdate: undefined },
      ];

      for (const configOverride of configs) {
        vi.clearAllMocks();
        vi.resetModules();

        // Re-setup default mocks after resetModules
        const { getInstallDirs } = await import("@/utils/path.js");
        vi.mocked(getInstallDirs).mockReturnValue(["/home/user/project"]);
        const { existsSync } = await import("fs");
        vi.mocked(existsSync).mockReturnValue(true);

        // Mock execSync to return newer version available
        const mockExecSync = vi.mocked(execSync);
        mockExecSync.mockReturnValue("14.2.0\n");

        // Mock loadConfig with the specific autoupdate setting
        const { loadConfig } = await import("@/cli/config.js");
        const mockLoadConfig = vi.mocked(loadConfig);
        mockLoadConfig.mockResolvedValue({
          auth: null,
          agents: null,
          version: "14.1.0",
          ...configOverride,
          installDir: process.cwd(),
        });

        const consoleLogSpy = vi
          .spyOn(console, "log")
          .mockImplementation(() => undefined);

        const autoupdate = await import("./autoupdate.js");
        await autoupdate.main();

        // Verify notification was shown regardless of autoupdate config
        expect(consoleLogSpy).toHaveBeenCalled();
        const logOutput = consoleLogSpy.mock.calls[0][0];
        const parsed = JSON.parse(logOutput);
        expect(parsed.systemMessage).toContain(
          "Nori Skillsets v14.2.0 available",
        );
        expect(parsed.systemMessage).toContain("current: v14.1.0");
        expect(parsed.systemMessage).toContain("npm install -g nori-skillsets");
        expect(parsed.systemMessage).toContain(
          "nori-skillsets switch-skillset",
        );

        consoleLogSpy.mockRestore();
      }
    });
  });
});
