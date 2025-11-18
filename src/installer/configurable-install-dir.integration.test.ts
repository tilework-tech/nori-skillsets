/**
 * Integration tests for configurable installation directory feature
 * Tests the full installation flow with custom install directories
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { loadDiskConfig, generateConfig, type Config } from "./config.js";
import { claudeMdLoader } from "./features/claudemd/loader.js";
import { profilesLoader } from "./features/profiles/loader.js";
import { skillsLoader } from "./features/skills/loader.js";

// Mock env module to use test directories
let mockInstallDir: string;

vi.mock("@/installer/env.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getClaudeDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude");
    },
    getClaudeSettingsFile: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "settings.json");
    },
    getClaudeProfilesDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "profiles");
    },
    getClaudeSkillsDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "skills");
    },
    getClaudeAgentsDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "agents");
    },
    getClaudeCommandsDir: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "commands");
    },
    getClaudeMdFile: (args?: { installDir?: string | null }) => {
      const installDir = args?.installDir || mockInstallDir;
      return path.join(installDir, ".claude", "CLAUDE.md");
    },
  };
});

describe("configurable install directory integration", () => {
  let tempDir: string;
  let customInstallDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "configurable-install-test-"),
    );
    customInstallDir = path.join(tempDir, "my-project");
    await fs.mkdir(customInstallDir, { recursive: true });

    // Set mock install directory
    mockInstallDir = customInstallDir;

    // Mock HOME for any legacy code paths
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear mocks
    vi.clearAllMocks();
  });

  describe("installation to custom directory", () => {
    it("should install profiles to custom installDir/.claude/profiles", async () => {
      const config: Config = {
        installType: "free",
        profile: { baseProfile: "senior-swe" },
        installDir: customInstallDir,
      };

      await profilesLoader.run({ config });

      // Verify profiles were installed to custom location
      const profilesDir = path.join(customInstallDir, ".claude", "profiles");
      const exists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify at least one profile exists
      const profiles = await fs.readdir(profilesDir);
      expect(profiles.length).toBeGreaterThan(0);
    });

    it("should install skills to custom installDir/.claude/skills", async () => {
      const config: Config = {
        installType: "free",
        profile: { baseProfile: "senior-swe" },
        installDir: customInstallDir,
      };

      // First install profiles (skills depend on profiles)
      await profilesLoader.run({ config });

      // Then install skills
      await skillsLoader.run({ config });

      // Verify skills were installed to custom location
      const skillsDir = path.join(customInstallDir, ".claude", "skills");
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify at least one skill exists
      const skills = await fs.readdir(skillsDir);
      expect(skills.length).toBeGreaterThan(0);
    });

    it("should create CLAUDE.md in custom installDir/.claude", async () => {
      const config: Config = {
        installType: "free",
        profile: { baseProfile: "senior-swe" },
        installDir: customInstallDir,
      };

      // Install profiles first
      await profilesLoader.run({ config });

      // Then create CLAUDE.md
      await claudeMdLoader.run({ config });

      // Verify CLAUDE.md was created
      const claudeMdPath = path.join(customInstallDir, ".claude", "CLAUDE.md");
      const exists = await fs
        .access(claudeMdPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify content has managed block
      const content = await fs.readFile(claudeMdPath, "utf-8");
      expect(content).toContain("BEGIN NORI-AI MANAGED BLOCK");
    });

    it("should create settings.json with correct paths", async () => {
      const config: Config = {
        installType: "free",
        profile: { baseProfile: "senior-swe" },
        installDir: customInstallDir,
      };

      // Install profiles
      await profilesLoader.run({ config });

      // Install skills (adds to settings.json permissions)
      await skillsLoader.run({ config });

      // Verify settings.json was created
      const settingsPath = path.join(
        customInstallDir,
        ".claude",
        "settings.json",
      );
      const exists = await fs
        .access(settingsPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify settings content
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Should have permissions with custom paths
      expect(settings.permissions).toBeDefined();
      expect(settings.permissions.additionalDirectories).toBeDefined();
    });

    it("should NOT create anything in ~/.claude (home directory)", async () => {
      const config: Config = {
        installType: "free",
        profile: { baseProfile: "senior-swe" },
        installDir: customInstallDir,
      };

      await profilesLoader.run({ config });

      // Verify nothing was created in HOME/.claude
      const homeClaudeDir = path.join(tempDir, ".claude");
      const exists = await fs
        .access(homeClaudeDir)
        .then(() => true)
        .catch(() => false);

      // Should be false - nothing in home directory
      expect(exists).toBe(false);
    });
  });

  describe("config file location", () => {
    it("should save config to installDir/.nori-config.json", async () => {
      const { saveDiskConfig } = await import("./config.js");

      await saveDiskConfig({
        username: null,
        password: null,
        organizationUrl: null,
        profile: { baseProfile: "senior-swe" },
        installDir: customInstallDir,
      });

      // Config should be at custom location
      const configPath = path.join(customInstallDir, ".nori-config.json");
      const exists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Should NOT be in home directory
      const homeConfig = path.join(tempDir, "nori-config.json");
      const homeExists = await fs
        .access(homeConfig)
        .then(() => true)
        .catch(() => false);
      expect(homeExists).toBe(false);
    });

    it("should load config from installDir/.nori-config.json", async () => {
      // Write config to custom location
      const configPath = path.join(customInstallDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          username: "test@example.com",
          password: "testpass",
          organizationUrl: "https://test.com",
          profile: { baseProfile: "amol" },
          installDir: customInstallDir,
        }),
      );

      const loaded = await loadDiskConfig({ installDir: customInstallDir });

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "https://test.com",
      });
      expect(loaded?.profile).toEqual({ baseProfile: "amol" });
      expect(loaded?.installDir).toBe(customInstallDir);
    });

    it("should generate config with installDir preserved", async () => {
      const diskConfig = {
        auth: null,
        profile: { baseProfile: "senior-swe" },
        installDir: customInstallDir,
      };

      const config = generateConfig({ diskConfig });

      expect(config.installDir).toBe(customInstallDir);
      expect(config.installType).toBe("free");
    });
  });

  describe("multiple isolated installations", () => {
    it("should support two separate installations without interference", async () => {
      const install1Dir = path.join(tempDir, "project1");
      const install2Dir = path.join(tempDir, "project2");
      await fs.mkdir(install1Dir, { recursive: true });
      await fs.mkdir(install2Dir, { recursive: true });

      const { saveDiskConfig } = await import("./config.js");

      // Save config to first installation
      await saveDiskConfig({
        username: "user1@example.com",
        password: "pass1",
        organizationUrl: "https://org1.com",
        profile: { baseProfile: "senior-swe" },
        installDir: install1Dir,
      });

      // Save config to second installation
      await saveDiskConfig({
        username: "user2@example.com",
        password: "pass2",
        organizationUrl: "https://org2.com",
        profile: { baseProfile: "amol" },
        installDir: install2Dir,
      });

      // Load and verify first config
      const config1 = await loadDiskConfig({ installDir: install1Dir });
      expect(config1?.auth?.username).toBe("user1@example.com");
      expect(config1?.profile?.baseProfile).toBe("senior-swe");

      // Load and verify second config
      const config2 = await loadDiskConfig({ installDir: install2Dir });
      expect(config2?.auth?.username).toBe("user2@example.com");
      expect(config2?.profile?.baseProfile).toBe("amol");

      // Verify they are completely separate
      expect(config1?.auth?.username).not.toBe(config2?.auth?.username);
    });
  });
});
