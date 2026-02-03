/**
 * Tests for the logout command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, saveConfig } from "@/cli/config.js";

import { logoutMain } from "./logout.js";

// Mock logger to suppress output during tests
vi.mock("@/cli/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  newline: vi.fn(),
  raw: vi.fn(),
}));

describe("logout command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "logout-test-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("logoutMain", () => {
    it("should clear auth fields but preserve other config", async () => {
      // Create config with auth and other settings
      await saveConfig({
        username: "user@example.com",
        refreshToken: "mock-refresh-token",
        organizationUrl: "https://noriskillsets.dev",
        organizations: ["acme", "orderco"],
        isAdmin: true,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        autoupdate: "enabled",
        installDir: tempDir,
      });

      // Verify auth exists before logout
      const beforeLogout = await loadConfig({ installDir: tempDir });
      expect(beforeLogout?.auth).not.toBeNull();

      // Perform logout
      await logoutMain({ installDir: tempDir });

      // Verify auth is cleared
      const afterLogout = await loadConfig({ installDir: tempDir });
      expect(afterLogout?.auth).toBeNull();

      // Verify other fields are preserved
      expect(afterLogout?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(afterLogout?.autoupdate).toBe("enabled");
    });

    it("should show info message when not logged in", async () => {
      const { info } = await import("@/cli/logger.js");

      // Create config without auth
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: tempDir,
      });

      await logoutMain({ installDir: tempDir });

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Not currently logged in"),
        }),
      );
    });

    it("should show info message when no config exists", async () => {
      const { info } = await import("@/cli/logger.js");

      await logoutMain({ installDir: tempDir });

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Not currently logged in"),
        }),
      );
    });

    it("should show success message after logging out", async () => {
      const { success } = await import("@/cli/logger.js");

      // Create config with auth
      await saveConfig({
        username: "user@example.com",
        refreshToken: "mock-refresh-token",
        organizationUrl: "https://noriskillsets.dev",
        installDir: tempDir,
      });

      await logoutMain({ installDir: tempDir });

      expect(success).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Logged out"),
        }),
      );
    });

    it("should clear auth from a Google SSO-authenticated session", async () => {
      // Create config that looks like it came from Google SSO login
      // (same fields as email/password, just different origin)
      await saveConfig({
        username: "googleuser@gmail.com",
        refreshToken: "firebase-refresh-token-from-google-sso",
        organizationUrl: "https://noriskillsets.dev",
        organizations: ["google-org"],
        isAdmin: false,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        autoupdate: "disabled",
        installDir: tempDir,
      });

      // Verify auth exists before logout
      const beforeLogout = await loadConfig({ installDir: tempDir });
      expect(beforeLogout?.auth?.username).toBe("googleuser@gmail.com");
      expect(beforeLogout?.auth?.refreshToken).toBe(
        "firebase-refresh-token-from-google-sso",
      );

      // Perform logout
      await logoutMain({ installDir: tempDir });

      // Verify auth is cleared
      const afterLogout = await loadConfig({ installDir: tempDir });
      expect(afterLogout?.auth).toBeNull();

      // Verify other fields are preserved
      expect(afterLogout?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(afterLogout?.autoupdate).toBe("disabled");
    });

    it("should clear auth from .nori subdirectory config when no installDir provided", async () => {
      const { success } = await import("@/cli/logger.js");

      // Create .nori subdirectory (mimics home directory installation pattern)
      const noriSubdir = path.join(tempDir, ".nori");
      await fs.mkdir(noriSubdir, { recursive: true });

      // Create config with auth in the .nori subdirectory
      await saveConfig({
        username: "user@example.com",
        refreshToken: "mock-refresh-token",
        organizationUrl: "https://noriskillsets.dev",
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: noriSubdir,
      });

      // Verify auth exists before logout
      const beforeLogout = await loadConfig({ installDir: noriSubdir });
      expect(beforeLogout?.auth?.username).toBe("user@example.com");

      // Perform logout without installDir - should auto-detect the .nori subdirectory
      await logoutMain({ searchDir: tempDir });

      // Verify auth is cleared
      const afterLogout = await loadConfig({ installDir: noriSubdir });
      expect(afterLogout?.auth).toBeNull();

      // Verify success message was shown
      expect(success).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Logged out"),
        }),
      );
    });

    it("should clear auth from all detected installations when no installDir provided", async () => {
      const { success } = await import("@/cli/logger.js");

      // Create .nori subdirectory
      const noriSubdir = path.join(tempDir, ".nori");
      await fs.mkdir(noriSubdir, { recursive: true });

      // Create config with auth at root level
      await saveConfig({
        username: "root-user@example.com",
        refreshToken: "root-token",
        organizationUrl: "https://noriskillsets.dev",
        installDir: tempDir,
      });

      // Create config with auth in .nori subdirectory
      await saveConfig({
        username: "nori-user@example.com",
        refreshToken: "nori-token",
        organizationUrl: "https://noriskillsets.dev",
        installDir: noriSubdir,
      });

      // Verify both have auth before logout
      const rootBefore = await loadConfig({ installDir: tempDir });
      const noriBefore = await loadConfig({ installDir: noriSubdir });
      expect(rootBefore?.auth?.username).toBe("root-user@example.com");
      expect(noriBefore?.auth?.username).toBe("nori-user@example.com");

      // Perform logout without installDir - should clear auth from both
      await logoutMain({ searchDir: tempDir });

      // Verify auth is cleared from both
      const rootAfter = await loadConfig({ installDir: tempDir });
      const noriAfter = await loadConfig({ installDir: noriSubdir });
      expect(rootAfter?.auth).toBeNull();
      expect(noriAfter?.auth).toBeNull();

      // Verify success message indicates multiple installations
      expect(success).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("2 installations"),
        }),
      );
    });
  });
});
