/**
 * Tests for API base module
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ConfigManager } from "./base.js";

describe("ConfigManager", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nori-test-"));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadConfig", () => {
    it("should load config from current directory when .nori-config.json exists", () => {
      // Setup: Create project with config
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      const configPath = path.join(projectDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to project directory
      process.chdir(projectDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify
      expect(result).toEqual(configData);
    });

    it("should load config from parent directory when running from subdirectory", () => {
      // Setup: Create project with config and subdirectory
      const projectDir = path.join(tempDir, "project");
      const srcDir = path.join(projectDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const configPath = path.join(projectDir, ".nori-config.json");
      const configData = {
        username: "test@example.com",
        password: "testpass",
        organizationUrl: "https://test.nori.ai",
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Change to subdirectory
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

      // Change to empty directory
      process.chdir(emptyDir);

      // Execute & Verify
      const result = ConfigManager.loadConfig();
      expect(result).toBeNull();
    });

    it("should handle empty config file gracefully (race condition)", () => {
      // Setup: Create project with empty config file
      const projectDir = path.join(tempDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      const configPath = path.join(projectDir, ".nori-config.json");
      fs.writeFileSync(configPath, ""); // Empty file

      // Change to project directory
      process.chdir(projectDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should return empty object for empty file
      expect(result).toEqual({});
    });

    it("should prefer closest installation when multiple exist", () => {
      // Setup: Create nested installations
      const rootDir = path.join(tempDir, "root");
      const projectDir = path.join(rootDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Root config
      const rootConfigPath = path.join(rootDir, ".nori-config.json");
      const rootConfigData = {
        username: "root@example.com",
        password: "rootpass",
        organizationUrl: "https://root.nori.ai",
      };
      fs.writeFileSync(rootConfigPath, JSON.stringify(rootConfigData, null, 2));

      // Project config (should be preferred)
      const projectConfigPath = path.join(projectDir, ".nori-config.json");
      const projectConfigData = {
        username: "project@example.com",
        password: "projectpass",
        organizationUrl: "https://project.nori.ai",
      };
      fs.writeFileSync(
        projectConfigPath,
        JSON.stringify(projectConfigData, null, 2),
      );

      // Change to project directory
      process.chdir(projectDir);

      // Execute
      const result = ConfigManager.loadConfig();

      // Verify - should use closest (project) config
      expect(result).toEqual(projectConfigData);
    });
  });
});
