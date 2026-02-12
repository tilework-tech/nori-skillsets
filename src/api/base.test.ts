/**
 * Tests for API base module
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ConfigManager } from "./base.js";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn().mockReturnValue(actual.homedir()) };
});

describe("ConfigManager", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nori-test-"));
    originalCwd = process.cwd();
    vi.mocked(os.homedir).mockReturnValue(tempDir);
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadConfig", () => {
    it("should load config from centralized ~/.nori-config.json", () => {
      // Setup: Write config at centralized location (homedir)
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to a subdirectory (getInstallDirs walks up and finds config at tempDir)
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      process.chdir(projectDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify
      expect(result).toEqual(configData);
    });

    it("should load config when running from subdirectory", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to a nested subdirectory
      const srcDir = path.join(tempDir, "project", "src");
      fs.mkdirSync(srcDir, { recursive: true });
      process.chdir(srcDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify
      expect(result).toEqual(configData);
    });

    it("should return null when no installation found", () => {
      // Setup: Create empty directory with no config
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });

      // Change to empty directory (no config anywhere in tree)
      process.chdir(emptyDir);

      // Execute & Verify
      const result = ConfigManager.loadConfig();
      expect(result).toBeNull();
    });

    it("should handle empty config file gracefully (race condition)", () => {
      // Setup: Write empty config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      fs.writeFileSync(configPath, ""); // Empty file

      // Change to tempDir so getInstallDirs finds it
      process.chdir(tempDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should return empty object for empty file
      expect(result).toEqual({});
    });

    it("should always read from centralized config regardless of cwd config", () => {
      // Setup: Create a project-level config and a centralized config
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Write project-level config (used by getInstallDirs to detect installation)
      const projectConfigPath = path.join(projectDir, ".nori-config.json");
      fs.writeFileSync(
        projectConfigPath,
        JSON.stringify({
          username: "project@example.com",
          password: "projectpass",
          organizationUrl: "https://project.nori.ai",
        }),
      );

      // Write centralized config at homedir
      const centralConfigPath = path.join(tempDir, ".nori-config.json");
      const centralConfigData = {
        username: "central@example.com",
        password: "centralpass",
        organizationUrl: "https://central.nori.ai",
      };
      fs.writeFileSync(
        centralConfigPath,
        JSON.stringify(centralConfigData, null, 2),
      );

      // Change to project directory
      process.chdir(projectDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should use centralized config (getConfigPath() = ~/.nori-config.json)
      expect(result).toEqual(centralConfigData);
    });

    it("should extract auth from nested format with refreshToken (v19+)", () => {
      // Setup: Write nested auth config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          refreshToken: "test-refresh-token",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to tempDir so getInstallDirs finds it
      process.chdir(tempDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should extract auth fields to root level
      expect(result).toEqual({
        username: "test@example.com",
        password: null,
        refreshToken: "test-refresh-token",
        organizationUrl: "https://test.nori.ai",
      });
    });

    it("should extract auth from nested format with password (v19+)", () => {
      // Setup: Write nested auth config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          password: "test-password",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to tempDir so getInstallDirs finds it
      process.chdir(tempDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should extract auth fields to root level
      expect(result).toEqual({
        username: "test@example.com",
        password: "test-password",
        refreshToken: null,
        organizationUrl: "https://test.nori.ai",
      });
    });
  });

  describe("isConfigured", () => {
    it("should return true for nested auth format with refreshToken", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          refreshToken: "test-refresh-token",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(true);
    });

    it("should return true for nested auth format with password", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          password: "test-password",
          organizationUrl: "https://test.nori.ai",
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(true);
    });

    it("should return true for legacy flat auth format (backwards compat)", () => {
      // Setup: Write config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "test-password",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(true);
    });

    it("should return false when auth is incomplete", () => {
      // Setup: Write incomplete config at centralized location
      const configPath = path.join(tempDir, ".nori-config.json");
      const configData = {
        auth: {
          username: "test@example.com",
          // Missing password/refreshToken and organizationUrl
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      process.chdir(tempDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(false);
    });

    it("should return false when no config exists", () => {
      // Setup: Create empty directory with no config
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });

      // Change to empty directory
      process.chdir(emptyDir);

      // Execute & Verify
      expect(ConfigManager.isConfigured()).toBe(false);
    });
  });
});
