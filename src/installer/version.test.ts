import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock env module before importing version
vi.mock("./env.js", () => {
  // Create a temporary directory for test package.json
  const testRoot = "/tmp/version-test-mcp-root";
  return {
    MCP_ROOT: testRoot,
  };
});

import { getConfigPath } from "./config.js";
import { MCP_ROOT } from "./env.js";
import {
  getCurrentPackageVersion,
  getInstalledVersion,
  saveInstalledVersion,
  hasExistingInstallation,
} from "./version.js";

describe("version", () => {
  describe("getCurrentPackageVersion", () => {
    const testPackageJsonPath = path.join(MCP_ROOT, "package.json");

    beforeEach(() => {
      // Ensure test directory exists
      if (!fs.existsSync(MCP_ROOT)) {
        fs.mkdirSync(MCP_ROOT, { recursive: true });
      }
    });

    afterEach(() => {
      // Clean up test package.json
      try {
        fs.unlinkSync(testPackageJsonPath);
      } catch {
        // Ignore if doesn't exist
      }
    });

    it("should return version from package.json with name nori-ai", () => {
      // Create test package.json with correct name
      const testPackage = {
        name: "nori-ai",
        version: "13.5.2",
      };
      fs.writeFileSync(testPackageJsonPath, JSON.stringify(testPackage));

      const version = getCurrentPackageVersion();

      expect(version).toBe("13.5.2");
    });

    it("should return null if package.json has wrong name", () => {
      // Create test package.json with wrong name
      const testPackage = {
        name: "wrong-package",
        version: "1.0.0",
      };
      fs.writeFileSync(testPackageJsonPath, JSON.stringify(testPackage));

      const version = getCurrentPackageVersion();

      expect(version).toBeNull();
    });

    it("should return null if package.json does not exist", () => {
      // Ensure no package.json exists
      try {
        fs.unlinkSync(testPackageJsonPath);
      } catch {
        // Already doesn't exist
      }

      const version = getCurrentPackageVersion();

      expect(version).toBeNull();
    });
  });

  describe("getInstalledVersion", () => {
    let tempDir: string;
    let originalCwd: () => string;
    let VERSION_FILE_PATH: string;

    beforeEach(async () => {
      // Create temp directory for testing
      tempDir = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), "version-test-getInstalledVersion-"),
      );

      // Save original cwd
      originalCwd = process.cwd;

      // Mock cwd to temp directory
      process.cwd = () => tempDir;

      // NOW compute path - it will use the mocked cwd
      VERSION_FILE_PATH = path.join(tempDir, ".nori-installed-version");
    });

    afterEach(async () => {
      // Restore cwd
      process.cwd = originalCwd;

      // Clean up temp directory
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore if cleanup fails
      }
    });

    it("should return version from .nori-installed-version in cwd", () => {
      // Create a test version file
      fs.writeFileSync(VERSION_FILE_PATH, "13.5.2", "utf-8");

      const version = getInstalledVersion({ installDir: tempDir });
      expect(version).toBe("13.5.2");
    });

    it("should return 12.1.0 if version file does not exist", () => {
      // Ensure file doesn't exist
      try {
        fs.unlinkSync(VERSION_FILE_PATH);
      } catch {
        // Ignore if already doesn't exist
      }

      const version = getInstalledVersion({ installDir: tempDir });
      expect(version).toBe("12.1.0");
    });

    it("should return 12.1.0 if version file is invalid", () => {
      // Create an empty version file
      fs.writeFileSync(VERSION_FILE_PATH, "", "utf-8");

      const version = getInstalledVersion({ installDir: tempDir });
      expect(version).toBe("12.1.0");
    });

    it("should trim whitespace from version file", () => {
      // Create version file with whitespace
      fs.writeFileSync(VERSION_FILE_PATH, "  14.0.0  \n", "utf-8");

      const version = getInstalledVersion({ installDir: tempDir });
      expect(version).toBe("14.0.0");
    });

    it("should never delete real user version file", () => {
      // This test verifies that process.cwd is mocked and tests never touch the real version file
      // Get what the real version path WOULD be (using originalCwd from beforeEach)
      const realVersionPath = path.join(
        originalCwd(),
        ".nori-installed-version",
      );

      // Check if real version file exists before test
      let existedBefore = false;
      try {
        fs.accessSync(realVersionPath);
        existedBefore = true;
      } catch {
        // File doesn't exist, which is fine
      }

      // Verify that VERSION_FILE_PATH used by tests is NOT the real version path
      // This proves cwd is mocked
      expect(VERSION_FILE_PATH).not.toBe(realVersionPath);

      // Verify the test cwd is actually different from real cwd
      // (We expect process.cwd() to be a temp directory like /tmp/version-test-getInstalledVersion-XXXXXX)
      expect(process.cwd()).toContain("/tmp/");
      expect(process.cwd()).toContain("version-test-getInstalledVersion-");

      // Run all the test operations
      fs.writeFileSync(VERSION_FILE_PATH, "13.5.2", "utf-8");
      getInstalledVersion({ installDir: tempDir });

      // Verify real version file still exists (if it existed before)
      if (existedBefore) {
        let existsAfter = false;
        try {
          fs.accessSync(realVersionPath);
          existsAfter = true;
        } catch {
          // File was deleted!
        }
        expect(existsAfter).toBe(true);
      }
    });
  });

  describe("saveInstalledVersion", () => {
    let tempDir: string;
    let originalCwd: () => string;
    let VERSION_FILE_PATH: string;

    beforeEach(async () => {
      // Create temp directory for testing
      tempDir = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), "version-test-saveInstalledVersion-"),
      );

      // Save original cwd
      originalCwd = process.cwd;

      // Mock cwd to temp directory
      process.cwd = () => tempDir;

      // NOW compute path - it will use the mocked cwd
      VERSION_FILE_PATH = path.join(tempDir, ".nori-installed-version");
    });

    afterEach(async () => {
      // Restore cwd
      process.cwd = originalCwd;

      // Clean up temp directory
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore if cleanup fails
      }
    });

    it("should save version to .nori-installed-version in cwd", () => {
      saveInstalledVersion({ version: "15.0.0", installDir: tempDir });

      const savedVersion = fs.readFileSync(VERSION_FILE_PATH, "utf-8");
      expect(savedVersion).toBe("15.0.0");
    });

    it("should overwrite existing version file", () => {
      // Create initial version file
      fs.writeFileSync(VERSION_FILE_PATH, "10.0.0", "utf-8");

      // Overwrite with new version
      saveInstalledVersion({ version: "11.0.0", installDir: tempDir });

      const savedVersion = fs.readFileSync(VERSION_FILE_PATH, "utf-8");
      expect(savedVersion).toBe("11.0.0");
    });

    it("should never delete real user version file", () => {
      // This test verifies that process.cwd is mocked and tests never touch the real version file
      // Get what the real version path WOULD be (using originalCwd from beforeEach)
      const realVersionPath = path.join(
        originalCwd(),
        ".nori-installed-version",
      );

      // Check if real version file exists before test
      let existedBefore = false;
      try {
        fs.accessSync(realVersionPath);
        existedBefore = true;
      } catch {
        // File doesn't exist, which is fine
      }

      // Verify that VERSION_FILE_PATH used by tests is NOT the real version path
      // This proves cwd is mocked
      expect(VERSION_FILE_PATH).not.toBe(realVersionPath);

      // Verify the test cwd is actually different from real cwd
      // (We expect process.cwd() to be a temp directory like /tmp/version-test-saveInstalledVersion-XXXXXX)
      expect(process.cwd()).toContain("/tmp/");
      expect(process.cwd()).toContain("version-test-saveInstalledVersion-");

      // Run all the test operations
      saveInstalledVersion({ version: "15.0.0", installDir: tempDir });

      // Verify real version file still exists (if it existed before)
      if (existedBefore) {
        let existsAfter = false;
        try {
          fs.accessSync(realVersionPath);
          existsAfter = true;
        } catch {
          // File was deleted!
        }
        expect(existsAfter).toBe(true);
      }
    });
  });

  describe("hasExistingInstallation", () => {
    let tempDir: string;
    let originalCwd: () => string;
    let VERSION_FILE_PATH: string;
    let CONFIG_PATH: string;

    beforeEach(async () => {
      // Create temp directory for testing
      tempDir = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), "version-test-"),
      );

      // Mock cwd
      originalCwd = process.cwd;
      process.cwd = () => tempDir;

      // Now paths point to temp directory
      VERSION_FILE_PATH = path.join(tempDir, ".nori-installed-version");
      CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Clean up any existing files in temp dir
      try {
        fs.unlinkSync(VERSION_FILE_PATH);
      } catch {}
      try {
        fs.unlinkSync(CONFIG_PATH);
      } catch {}
    });

    afterEach(async () => {
      // Restore cwd
      process.cwd = originalCwd;

      // Clean up temp directory
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it("should return false when neither version file nor config exists", () => {
      expect(hasExistingInstallation({ installDir: tempDir })).toBe(false);
    });

    it("should return true when version file exists", () => {
      fs.writeFileSync(VERSION_FILE_PATH, "13.0.0");
      expect(hasExistingInstallation({ installDir: tempDir })).toBe(true);
    });

    it("should return true when config file exists", () => {
      fs.writeFileSync(CONFIG_PATH, "{}");
      expect(hasExistingInstallation({ installDir: tempDir })).toBe(true);
    });

    it("should return true when both version and config files exist", () => {
      fs.writeFileSync(VERSION_FILE_PATH, "13.0.0");
      fs.writeFileSync(CONFIG_PATH, "{}");
      expect(hasExistingInstallation({ installDir: tempDir })).toBe(true);
    });

    it("should never delete real user config file", () => {
      // This test verifies that process.cwd is mocked and tests never touch the real config file
      // Get what the real config path WOULD be (using originalCwd from beforeEach)
      const realConfigPath = path.join(originalCwd(), ".nori-config.json");

      // Check if real config exists before test
      let existedBefore = false;
      try {
        fs.accessSync(realConfigPath);
        existedBefore = true;
      } catch {
        // File doesn't exist, which is fine
      }

      // Verify that CONFIG_PATH used by tests is NOT the real config path
      // This proves cwd is mocked
      expect(CONFIG_PATH).not.toBe(realConfigPath);

      // Run all the test operations
      try {
        fs.unlinkSync(VERSION_FILE_PATH);
      } catch {}
      try {
        fs.unlinkSync(CONFIG_PATH);
      } catch {}

      fs.writeFileSync(CONFIG_PATH, "{}");
      hasExistingInstallation({ installDir: tempDir });

      try {
        fs.unlinkSync(CONFIG_PATH);
      } catch {}

      // Verify real config still exists (if it existed before)
      if (existedBefore) {
        let existsAfter = false;
        try {
          fs.accessSync(realConfigPath);
          existsAfter = true;
        } catch {
          // File was deleted!
        }
        expect(existsAfter).toBe(true);
      }
    });
  });
});
