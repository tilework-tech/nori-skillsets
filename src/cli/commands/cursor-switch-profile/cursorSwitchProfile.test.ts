/**
 * Tests for cursor-switch-profile CLI command
 * Verifies switching Cursor profiles updates config and reinstalls
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { installCursorMain } from "@/cli/commands/install-cursor/installCursor.js";
import { loadConfig, saveConfig } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockCursorDir = "";
let mockInstallDir = "";

vi.mock("@/cli/env.js", () => ({
  getClaudeDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude"),
  getClaudeSettingsFile: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "settings.json"),
  getClaudeProfilesDir: (args: { installDir: string }) =>
    path.join(args.installDir, ".claude", "profiles"),
  getCursorDir: () => mockCursorDir,
  getCursorSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  getCursorProfilesDir: () => path.join(mockCursorDir, "profiles"),
  getCursorHomeDir: () => mockCursorDir,
  getCursorHomeSettingsFile: () => path.join(mockCursorDir, "settings.json"),
  MCP_ROOT: "/mock/mcp/root",
}));

// Mock os.homedir to return tempDir
vi.mock("os", async () => {
  const actual = await vi.importActual<typeof os>("os");
  return {
    ...actual,
    homedir: () => mockInstallDir,
  };
});

// Mock installCursorMain to avoid actually installing
vi.mock("@/cli/commands/install-cursor/installCursor.js", () => ({
  installCursorMain: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import {
  cursorSwitchProfile,
  listCursorProfiles,
} from "./cursorSwitchProfile.js";

describe("cursor-switch-profile", () => {
  let tempDir: string;
  let cursorDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "cursor-switch-profile-test-"),
    );
    cursorDir = path.join(tempDir, ".cursor");
    profilesDir = path.join(cursorDir, "profiles");

    // Set mock paths
    mockCursorDir = cursorDir;
    mockInstallDir = tempDir;

    // Create directories
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });

    // Create some mock profiles
    const seniorSwePath = path.join(profilesDir, "senior-swe");
    await fs.mkdir(seniorSwePath, { recursive: true });
    await fs.writeFile(path.join(seniorSwePath, "CLAUDE.md"), "# Senior SWE");
    await fs.writeFile(
      path.join(seniorSwePath, "profile.json"),
      JSON.stringify({ builtin: true }),
    );

    const amolPath = path.join(profilesDir, "amol");
    await fs.mkdir(amolPath, { recursive: true });
    await fs.writeFile(path.join(amolPath, "CLAUDE.md"), "# Amol");
    await fs.writeFile(
      path.join(amolPath, "profile.json"),
      JSON.stringify({ builtin: true }),
    );

    // Clear mocks before each test
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("listCursorProfiles", () => {
    it("should list all profiles with CLAUDE.md files", async () => {
      const profiles = await listCursorProfiles();

      expect(profiles).toContain("senior-swe");
      expect(profiles).toContain("amol");
    });

    it("should not include directories without CLAUDE.md", async () => {
      // Create a directory without CLAUDE.md
      const noClaudeMdPath = path.join(profilesDir, "incomplete");
      await fs.mkdir(noClaudeMdPath, { recursive: true });

      const profiles = await listCursorProfiles();

      expect(profiles).not.toContain("incomplete");
    });

    it("should throw error if profiles directory does not exist", async () => {
      // Remove the profiles directory
      await fs.rm(profilesDir, { recursive: true, force: true });

      await expect(listCursorProfiles()).rejects.toThrow();
    });
  });

  describe("cursorSwitchProfile", () => {
    it("should throw error if profile does not exist", async () => {
      await expect(
        cursorSwitchProfile({ profileName: "nonexistent" }),
      ).rejects.toThrow('Profile "nonexistent" not found');
    });

    it("should update cursorProfile.baseProfile in config", async () => {
      // First create some initial config
      await saveConfig({
        username: null,
        password: null,
        organizationUrl: null,
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      });

      await cursorSwitchProfile({ profileName: "amol" });

      const config = await loadConfig({ installDir: tempDir });
      expect(config?.cursorProfile?.baseProfile).toBe("amol");
    });

    it("should preserve existing config fields when switching", async () => {
      // Create initial config with auth and profile
      await saveConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        profile: { baseProfile: "senior-swe" },
        sendSessionTranscript: "disabled",
        autoupdate: "enabled",
        installDir: tempDir,
      });

      await cursorSwitchProfile({ profileName: "amol" });

      const config = await loadConfig({ installDir: tempDir });
      // Auth should be preserved
      expect(config?.auth?.username).toBe("test@example.com");
      // Claude profile should be preserved
      expect(config?.profile?.baseProfile).toBe("senior-swe");
      // Cursor profile should be updated
      expect(config?.cursorProfile?.baseProfile).toBe("amol");
      // Other settings should be preserved
      expect(config?.sendSessionTranscript).toBe("disabled");
    });

    it("should call installCursorMain after switching profile", async () => {
      await cursorSwitchProfile({ profileName: "senior-swe" });

      expect(installCursorMain).toHaveBeenCalled();
    });

    it("should work when no previous config exists", async () => {
      // No config file exists initially
      await cursorSwitchProfile({ profileName: "senior-swe" });

      const config = await loadConfig({ installDir: tempDir });
      expect(config?.cursorProfile?.baseProfile).toBe("senior-swe");
    });
  });
});
