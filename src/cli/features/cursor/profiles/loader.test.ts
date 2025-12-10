/**
 * Tests for cursor profiles feature loader
 * Verifies install, uninstall, and validate operations write to Cursor directories
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Config } from "@/cli/config.js";

// Mock the env module to use temp directories
let mockCursorDir = "";

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
  MCP_ROOT: "/mock/mcp/root",
}));

// Import loader after mocking env
import { cursorProfilesLoader } from "./loader.js";

describe("cursorProfilesLoader", () => {
  let tempDir: string;
  let cursorDir: string;
  let profilesDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-profiles-test-"));
    cursorDir = path.join(tempDir, ".cursor");
    profilesDir = path.join(cursorDir, "profiles");

    // Set mock paths
    mockCursorDir = cursorDir;

    // Create directories
    await fs.mkdir(cursorDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct name", () => {
      expect(cursorProfilesLoader.name).toBe("cursor-profiles");
    });

    it("should have a description", () => {
      expect(cursorProfilesLoader.description).toBeDefined();
      expect(cursorProfilesLoader.description.length).toBeGreaterThan(0);
    });
  });

  describe("run", () => {
    it("should create profiles directory in Cursor directory", async () => {
      const config: Config = { installDir: tempDir };

      await cursorProfilesLoader.run({ config });

      // Verify profiles directory exists in .cursor, not .claude
      const cursorProfilesExists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);

      expect(cursorProfilesExists).toBe(true);
    });

    it("should copy profile templates to Cursor profiles directory", async () => {
      const config: Config = { installDir: tempDir };

      await cursorProfilesLoader.run({ config });

      // Verify profile directories were copied
      const files = await fs.readdir(profilesDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain("senior-swe");
      expect(files).toContain("amol");
      expect(files).toContain("product-manager");
      expect(files).toContain("none");
      expect(files).not.toContain("_base"); // _base is never installed
    });

    it("should copy profile directories with complete structure", async () => {
      const config: Config = {
        profile: { baseProfile: "senior-swe" },
        installDir: tempDir,
      };

      await cursorProfilesLoader.run({ config });

      // Verify senior-swe profile exists and is fully composed
      const seniorSwePath = path.join(profilesDir, "senior-swe");
      const seniorSweExists = await fs
        .access(seniorSwePath)
        .then(() => true)
        .catch(() => false);
      expect(seniorSweExists).toBe(true);

      // Verify it has CLAUDE.md and profile.json
      const claudeMdPath = path.join(seniorSwePath, "CLAUDE.md");
      const claudeMdExists = await fs
        .access(claudeMdPath)
        .then(() => true)
        .catch(() => false);
      expect(claudeMdExists).toBe(true);

      const profileJsonPath = path.join(seniorSwePath, "profile.json");
      const profileJsonExists = await fs
        .access(profileJsonPath)
        .then(() => true)
        .catch(() => false);
      expect(profileJsonExists).toBe(true);
    });

    it("should configure permissions in Cursor settings.json", async () => {
      const config: Config = { installDir: tempDir };

      await cursorProfilesLoader.run({ config });

      // Verify settings.json exists and contains profiles directory permission
      const settingsPath = path.join(cursorDir, "settings.json");
      const settingsExists = await fs
        .access(settingsPath)
        .then(() => true)
        .catch(() => false);
      expect(settingsExists).toBe(true);

      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(settings.permissions?.additionalDirectories).toContain(
        profilesDir,
      );
    });
  });

  describe("uninstall", () => {
    it("should remove built-in profiles from Cursor directory", async () => {
      const config: Config = { installDir: tempDir };

      // First install
      await cursorProfilesLoader.run({ config });

      // Verify profiles exist
      const filesBeforeUninstall = await fs.readdir(profilesDir);
      expect(filesBeforeUninstall.length).toBeGreaterThan(0);

      // Then uninstall
      await cursorProfilesLoader.uninstall({ config });

      // Verify built-in profiles are removed
      // The directory might still exist but should be empty or removed
      const dirExists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);

      if (dirExists) {
        const filesAfterUninstall = await fs.readdir(profilesDir);
        // Should have no built-in profiles left
        expect(filesAfterUninstall).not.toContain("senior-swe");
        expect(filesAfterUninstall).not.toContain("amol");
      }
    });

    it("should remove permissions from Cursor settings.json", async () => {
      const config: Config = { installDir: tempDir };

      // First install
      await cursorProfilesLoader.run({ config });

      // Verify permissions exist
      const settingsPath = path.join(cursorDir, "settings.json");
      let settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(settings.permissions?.additionalDirectories).toContain(
        profilesDir,
      );

      // Then uninstall
      await cursorProfilesLoader.uninstall({ config });

      // Verify permissions are removed
      settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(settings.permissions?.additionalDirectories || []).not.toContain(
        profilesDir,
      );
    });
  });

  describe("validate", () => {
    it("should return valid when profiles are properly installed", async () => {
      const config: Config = { installDir: tempDir };

      // First install
      await cursorProfilesLoader.run({ config });

      // Then validate
      const result = await cursorProfilesLoader.validate!({ config });

      expect(result.valid).toBe(true);
    });

    it("should return invalid when profiles directory does not exist", async () => {
      const config: Config = { installDir: tempDir };

      // Don't install, just validate
      const result = await cursorProfilesLoader.validate!({ config });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("should return valid when only selected profile is installed", async () => {
      const config: Config = {
        installDir: tempDir,
        cursorProfile: { baseProfile: "senior-swe" },
      };

      // First install only senior-swe
      await cursorProfilesLoader.run({ config });

      // Verify only one profile installed
      const files = await fs.readdir(profilesDir);
      expect(files).toContain("senior-swe");
      expect(files).not.toContain("amol");

      // Then validate - should pass with only selected profile
      const result = await cursorProfilesLoader.validate!({ config });

      expect(result.valid).toBe(true);
    });
  });

  describe("cursorProfile selection", () => {
    it("should install only selected profile when cursorProfile.baseProfile is set", async () => {
      const config: Config = {
        installDir: tempDir,
        cursorProfile: { baseProfile: "senior-swe" },
      };

      await cursorProfilesLoader.run({ config });

      // Verify only senior-swe profile is installed
      const files = await fs.readdir(profilesDir);
      expect(files).toContain("senior-swe");
      expect(files).not.toContain("amol");
      expect(files).not.toContain("product-manager");
      expect(files).not.toContain("documenter");
    });

    it("should install all profiles when cursorProfile is not set", async () => {
      const config: Config = { installDir: tempDir };

      await cursorProfilesLoader.run({ config });

      // Verify all profiles are installed
      const files = await fs.readdir(profilesDir);
      expect(files).toContain("senior-swe");
      expect(files).toContain("amol");
      expect(files).toContain("product-manager");
      expect(files).toContain("none");
    });

    it("should install all profiles when cursorProfile is null", async () => {
      const config: Config = {
        installDir: tempDir,
        cursorProfile: null,
      };

      await cursorProfilesLoader.run({ config });

      // Verify all profiles are installed
      const files = await fs.readdir(profilesDir);
      expect(files).toContain("senior-swe");
      expect(files).toContain("amol");
    });

    it("should configure permissions for selected profile directory", async () => {
      const config: Config = {
        installDir: tempDir,
        cursorProfile: { baseProfile: "amol" },
      };

      await cursorProfilesLoader.run({ config });

      // Verify settings.json has permissions for profiles directory
      const settingsPath = path.join(cursorDir, "settings.json");
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(settings.permissions?.additionalDirectories).toContain(
        profilesDir,
      );
    });
  });
});
