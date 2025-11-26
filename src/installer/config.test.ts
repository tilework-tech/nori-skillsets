/**
 * Tests for configuration management with profile-based system
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  loadDiskConfig,
  saveDiskConfig,
  generateConfig,
  getConfigPath,
  type DiskConfig,
} from "./config.js";

describe("getConfigPath", () => {
  let originalCwd: () => string;

  beforeEach(() => {
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe("default behavior", () => {
    it("should return installDir/.nori-config.json when valid installDir is provided", () => {
      const result = getConfigPath({ installDir: "/mock/project/dir" });
      expect(result).toBe("/mock/project/dir/.nori-config.json");
    });

    it("should handle relative path", () => {
      const result = getConfigPath({ installDir: "relative/path" });
      expect(result).toBe("relative/path/.nori-config.json");
    });
  });

  describe("custom installDir", () => {
    it("should return <installDir>/.nori-config.json when custom installDir provided", () => {
      const result = getConfigPath({ installDir: "/custom/path" });
      expect(result).toBe("/custom/path/.nori-config.json");
    });
  });
});

describe("config with profile-based system", () => {
  let tempDir: string;
  let mockConfigPath: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
    mockConfigPath = path.join(tempDir, ".nori-config.json");

    // Mock process.cwd() to return temp directory
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
  });

  afterEach(async () => {
    // Restore process.cwd
    process.cwd = originalCwd;

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("saveDiskConfig and loadDiskConfig", () => {
    it("should save and load profile along with auth", async () => {
      await saveDiskConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        profile: {
          baseProfile: "senior-swe",
        },
        installDir: tempDir,
      });

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
      });
      expect(loaded?.profile).toEqual({
        baseProfile: "senior-swe",
      });
    });

    it("should save and load auth without profile", async () => {
      await saveDiskConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        profile: null,
        installDir: tempDir,
      });

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.auth).toEqual({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
      });
      expect(loaded?.profile).toBeNull();
    });

    it("should save and load profile without auth", async () => {
      await saveDiskConfig({
        username: null,
        password: null,
        organizationUrl: null,
        profile: {
          baseProfile: "amol",
        },
        installDir: tempDir,
      });

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.auth).toBeNull();
      expect(loaded?.profile).toEqual({
        baseProfile: "amol",
      });
    });

    it("should return null when config file does not exist", async () => {
      const loaded = await loadDiskConfig({ installDir: tempDir });
      expect(loaded).toBeNull();
    });

    it("should handle malformed config gracefully", async () => {
      await fs.writeFile(mockConfigPath, "invalid json {");

      const loaded = await loadDiskConfig({ installDir: tempDir });
      expect(loaded).toBeNull();
    });

    it("should load sendSessionTranscript when set to enabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: "enabled" }),
      );

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("enabled");
    });

    it("should load sendSessionTranscript when set to disabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ sendSessionTranscript: "disabled" }),
      );

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("disabled");
    });

    it("should default sendSessionTranscript to enabled when field is missing", async () => {
      await fs.writeFile(mockConfigPath, JSON.stringify({}));

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("enabled");
    });

    it("should save and load sendSessionTranscript", async () => {
      await saveDiskConfig({
        username: null,
        password: null,
        organizationUrl: null,
        sendSessionTranscript: "disabled",
        installDir: tempDir,
      });

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.sendSessionTranscript).toBe("disabled");
    });

    it("should load autoupdate when set to enabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ autoupdate: "enabled" }),
      );

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("enabled");
    });

    it("should load autoupdate when set to disabled", async () => {
      await fs.writeFile(
        mockConfigPath,
        JSON.stringify({ autoupdate: "disabled" }),
      );

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("disabled");
    });

    it("should default autoupdate to enabled when field is missing", async () => {
      await fs.writeFile(mockConfigPath, JSON.stringify({}));

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("enabled");
    });

    it("should save and load autoupdate", async () => {
      await saveDiskConfig({
        username: null,
        password: null,
        organizationUrl: null,
        autoupdate: "disabled",
        installDir: tempDir,
      });

      const loaded = await loadDiskConfig({ installDir: tempDir });

      expect(loaded?.autoupdate).toBe("disabled");
    });
  });

  describe("generateConfig", () => {
    it("should generate paid config with profile from diskConfig", () => {
      const diskConfig: DiskConfig = {
        auth: {
          username: "test@example.com",
          password: "password123",
          organizationUrl: "https://example.com",
        },
        profile: {
          baseProfile: "senior-swe",
        },
        installDir: tempDir,
      };

      const config = generateConfig({ diskConfig, installDir: tempDir });

      expect(config.installType).toBe("paid");
      expect(config.profile).toEqual({
        baseProfile: "senior-swe",
      });
    });

    it("should generate free config with profile from diskConfig", () => {
      const diskConfig: DiskConfig = {
        auth: null,
        profile: {
          baseProfile: "amol",
        },
        installDir: tempDir,
      };

      const config = generateConfig({ diskConfig, installDir: tempDir });

      expect(config.installType).toBe("free");
      expect(config.profile).toEqual({
        baseProfile: "amol",
      });
    });

    it("should use default profile (senior-swe) when diskConfig has no profile", () => {
      const diskConfig: DiskConfig = {
        auth: null,
        profile: null,
        installDir: tempDir,
      };

      const config = generateConfig({ diskConfig, installDir: tempDir });

      expect(config.installType).toBe("free");
      expect(config.profile).toEqual({
        baseProfile: "senior-swe",
      });
    });

    it("should use default profile (senior-swe) when diskConfig is null", () => {
      const config = generateConfig({ diskConfig: null, installDir: tempDir });

      expect(config.installType).toBe("free");
      expect(config.profile).toEqual({
        baseProfile: "senior-swe",
      });
    });
  });

  describe("installDir configuration", () => {
    it("should save config to custom installDir as .nori-config.json", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      await saveDiskConfig({
        username: "test@example.com",
        password: "password123",
        organizationUrl: "https://example.com",
        installDir: customDir,
      });

      // Config should be at customDir/.nori-config.json
      const configPath = path.join(customDir, ".nori-config.json");
      const exists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Should NOT be at HOME/nori-config.json
      const homeConfig = path.join(tempDir, "nori-config.json");
      const homeExists = await fs
        .access(homeConfig)
        .then(() => true)
        .catch(() => false);
      expect(homeExists).toBe(false);
    });

    it("should load config from custom installDir", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      // Write config to custom location
      const configPath = path.join(customDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          username: "custom@example.com",
          password: "custompass",
          organizationUrl: "https://custom.com",
        }),
      );

      const loaded = await loadDiskConfig({ installDir: customDir });

      expect(loaded?.auth).toEqual({
        username: "custom@example.com",
        password: "custompass",
        organizationUrl: "https://custom.com",
      });
    });

    it("should return null when config does not exist in custom installDir", async () => {
      const customDir = path.join(tempDir, "empty-project");
      await fs.mkdir(customDir, { recursive: true });

      const loaded = await loadDiskConfig({ installDir: customDir });
      expect(loaded).toBeNull();
    });

    it("should save installDir in config for persistence", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      await saveDiskConfig({
        username: null,
        password: null,
        organizationUrl: null,
        profile: { baseProfile: "senior-swe" },
        installDir: customDir,
      });

      // Read the raw config to verify installDir is saved
      const configPath = path.join(customDir, ".nori-config.json");
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.installDir).toBe(customDir);
    });

    it("should load installDir from config", async () => {
      const customDir = path.join(tempDir, "custom-project");
      await fs.mkdir(customDir, { recursive: true });

      // Write config with installDir
      const configPath = path.join(customDir, ".nori-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          profile: { baseProfile: "senior-swe" },
          installDir: customDir,
        }),
      );

      const loaded = await loadDiskConfig({ installDir: customDir });
      expect(loaded?.installDir).toBe(customDir);
    });

    it("should include installDir in generated config", () => {
      const customDir = "/custom/project/path";
      const diskConfig: DiskConfig = {
        auth: null,
        profile: { baseProfile: "senior-swe" },
        installDir: customDir,
      };

      const config = generateConfig({ diskConfig, installDir: customDir });

      expect(config.installDir).toBe(customDir);
    });
  });
});
