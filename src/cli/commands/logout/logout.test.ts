/**
 * Tests for the logout command
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, saveConfig } from "@/cli/config.js";

// Mock os.homedir so getConfigPath resolves to test directories
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue(actual.homedir()),
  };
});

import { logoutMain } from "./logout.js";

// Mock @clack/prompts for output
vi.mock("@clack/prompts", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    step: vi.fn(),
  },
}));

describe("logout command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "logout-test-"));
    vi.mocked(os.homedir).mockReturnValue(tempDir);
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
      const beforeLogout = await loadConfig();
      expect(beforeLogout?.auth).not.toBeNull();

      // Perform logout
      await logoutMain({ installDir: tempDir });

      // Verify auth is cleared
      const afterLogout = await loadConfig();
      expect(afterLogout?.auth).toBeNull();

      // Verify other fields are preserved
      expect(afterLogout?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(afterLogout?.autoupdate).toBe("enabled");
    });

    it("should show info message when not logged in", async () => {
      const { log } = await import("@clack/prompts");

      // Create config without auth
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: tempDir,
      });

      await logoutMain({ installDir: tempDir });

      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining("Not currently logged in"),
      );
    });

    it("should show info message when no config exists", async () => {
      const { log } = await import("@clack/prompts");

      await logoutMain({ installDir: tempDir });

      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining("Not currently logged in"),
      );
    });

    it("should show success message after logging out", async () => {
      const { log } = await import("@clack/prompts");

      // Create config with auth
      await saveConfig({
        username: "user@example.com",
        refreshToken: "mock-refresh-token",
        organizationUrl: "https://noriskillsets.dev",
        installDir: tempDir,
      });

      await logoutMain({ installDir: tempDir });

      expect(log.success).toHaveBeenCalledWith(
        expect.stringContaining("Logged out"),
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
      const beforeLogout = await loadConfig();
      expect(beforeLogout?.auth?.username).toBe("googleuser@gmail.com");
      expect(beforeLogout?.auth?.refreshToken).toBe(
        "firebase-refresh-token-from-google-sso",
      );

      // Perform logout
      await logoutMain({ installDir: tempDir });

      // Verify auth is cleared
      const afterLogout = await loadConfig();
      expect(afterLogout?.auth).toBeNull();

      // Verify other fields are preserved
      expect(afterLogout?.agents?.["claude-code"]?.profile?.baseProfile).toBe(
        "senior-swe",
      );
      expect(afterLogout?.autoupdate).toBe("disabled");
    });

    it("should clear auth when no installDir provided and config exists at homedir", async () => {
      const { log } = await import("@clack/prompts");

      // Create config with auth at home directory (centralized config)
      await saveConfig({
        username: "user@example.com",
        refreshToken: "mock-refresh-token",
        organizationUrl: "https://noriskillsets.dev",
        agents: { "claude-code": { profile: { baseProfile: "senior-swe" } } },
        installDir: tempDir,
      });

      // Verify auth exists before logout
      const beforeLogout = await loadConfig();
      expect(beforeLogout?.auth?.username).toBe("user@example.com");

      // Perform logout without installDir - should find config at homedir
      // Config is centralized at ~/.nori-config.json (os.homedir() mocked to tempDir)
      await logoutMain();

      // Verify auth is cleared
      const afterLogout = await loadConfig();
      expect(afterLogout?.auth).toBeNull();

      // Verify success message was shown
      expect(log.success).toHaveBeenCalledWith(
        expect.stringContaining("Logged out"),
      );
    });
  });
});
