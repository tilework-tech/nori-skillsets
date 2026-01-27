import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { hasExistingInstallation } from "@/cli/commands/install/installState.js";

import { getConfigPath, saveConfig } from "./config.js";
import {
  getCurrentPackageVersion,
  getInstalledVersion,
  supportsAgentFlag,
} from "./version.js";

describe("version", () => {
  describe("getCurrentPackageVersion", () => {
    let testRoot: string;
    let testPackageJsonPath: string;

    beforeEach(() => {
      // Create a temporary directory for test package.json
      testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "version-test-"));
      testPackageJsonPath = path.join(testRoot, "package.json");
    });

    afterEach(() => {
      // Clean up temp directory
      try {
        fs.rmSync(testRoot, { recursive: true, force: true });
      } catch {
        // Ignore if cleanup fails
      }
    });

    it("should return version from package.json with name nori-ai", () => {
      // Create test package.json with correct name
      const testPackage = {
        name: "nori-ai",
        version: "13.5.2",
      };
      fs.writeFileSync(testPackageJsonPath, JSON.stringify(testPackage));

      // Pass startDir to control where the function looks for package.json
      const version = getCurrentPackageVersion({ startDir: testRoot });

      expect(version).toBe("13.5.2");
    });

    it("should return null if package.json has wrong name", () => {
      // Create test package.json with wrong name
      const testPackage = {
        name: "wrong-package",
        version: "1.0.0",
      };
      fs.writeFileSync(testPackageJsonPath, JSON.stringify(testPackage));

      const version = getCurrentPackageVersion({ startDir: testRoot });

      expect(version).toBeNull();
    });

    // @current-session
    it("should return version from package.json with name nori-skillsets", () => {
      // Create test package.json with nori-skillsets name (for nori-skillsets CLI)
      const testPackage = {
        name: "nori-skillsets",
        version: "0.3.0",
      };
      fs.writeFileSync(testPackageJsonPath, JSON.stringify(testPackage));

      const version = getCurrentPackageVersion({ startDir: testRoot });

      expect(version).toBe("0.3.0");
    });

    it("should return null if package.json does not exist", () => {
      // Don't create package.json - directory is empty
      const version = getCurrentPackageVersion({ startDir: testRoot });

      expect(version).toBeNull();
    });

    it("should find package.json in parent directory", () => {
      // Create nested directory structure
      const childDir = path.join(testRoot, "child", "grandchild");
      fs.mkdirSync(childDir, { recursive: true });

      // Put package.json in root, start search from grandchild
      const testPackage = {
        name: "nori-ai",
        version: "14.0.0",
      };
      fs.writeFileSync(testPackageJsonPath, JSON.stringify(testPackage));

      const version = getCurrentPackageVersion({ startDir: childDir });

      expect(version).toBe("14.0.0");
    });

    it("should use import.meta.url location when startDir not provided", () => {
      // When called without startDir, it should find the real nori-ai package.json
      // This verifies the default behavior works
      const version = getCurrentPackageVersion();

      // Should return the actual package version (not null)
      expect(version).not.toBeNull();
      // Should be a valid semver string
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("getInstalledVersion", () => {
    let tempDir: string;
    let originalCwd: () => string;

    beforeEach(async () => {
      // Create temp directory for testing
      tempDir = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), "version-test-getInstalledVersion-"),
      );

      // Save original cwd
      originalCwd = process.cwd;

      // Mock cwd to temp directory
      process.cwd = () => tempDir;
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

    it("should return version from config file", async () => {
      // Create a test config file with version
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: { "claude-code": {} },
        version: "13.5.2",
        installDir: tempDir,
      });

      const version = await getInstalledVersion({ installDir: tempDir });
      expect(version).toBe("13.5.2");
    });

    it("should throw error if config file does not exist", async () => {
      await expect(
        getInstalledVersion({ installDir: tempDir }),
      ).rejects.toThrow(
        "Installation out of date: no version field found in .nori-config.json file.",
      );
    });

    it("should throw error if config has no version field and no fallback file", async () => {
      // Create config without version field
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: { "claude-code": {} },
        installDir: tempDir,
      });

      // Ensure no fallback file exists
      const fallbackPath = path.join(tempDir, ".nori-installed-version");
      try {
        fs.unlinkSync(fallbackPath);
      } catch {
        // File doesn't exist, which is fine
      }

      await expect(
        getInstalledVersion({ installDir: tempDir }),
      ).rejects.toThrow(
        "Installation out of date: no version field found in .nori-config.json file.",
      );
    });

    it("should return version from .nori-installed-version fallback when config has no version", async () => {
      // Create config without version field
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: { "claude-code": {} },
        installDir: tempDir,
      });

      // Create fallback file with valid version
      fs.writeFileSync(path.join(tempDir, ".nori-installed-version"), "18.0.0");

      const version = await getInstalledVersion({ installDir: tempDir });
      expect(version).toBe("18.0.0");
    });

    it("should throw error if config has no version and fallback file has invalid semver", async () => {
      // Create config without version field
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: { "claude-code": {} },
        installDir: tempDir,
      });

      // Create fallback file with invalid version
      fs.writeFileSync(
        path.join(tempDir, ".nori-installed-version"),
        "not-a-version",
      );

      await expect(
        getInstalledVersion({ installDir: tempDir }),
      ).rejects.toThrow(
        "Installation out of date: no version field found in .nori-config.json file.",
      );
    });

    it("should never delete real user config file", async () => {
      // This test verifies that process.cwd is mocked and tests never touch the real config file
      const realConfigPath = path.join(originalCwd(), ".nori-config.json");

      // Check if real config file exists before test
      let existedBefore = false;
      try {
        fs.accessSync(realConfigPath);
        existedBefore = true;
      } catch {
        // File doesn't exist, which is fine
      }

      // Verify the test cwd is actually different from real cwd
      expect(process.cwd()).toContain(os.tmpdir());
      expect(process.cwd()).toContain("version-test-getInstalledVersion-");

      // Run all the test operations
      await saveConfig({
        username: null,
        organizationUrl: null,
        agents: { "claude-code": {} },
        version: "13.5.2",
        installDir: tempDir,
      });
      await getInstalledVersion({ installDir: tempDir });

      // Verify real config file still exists (if it existed before)
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

  describe("supportsAgentFlag", () => {
    it("should return false for versions before 19.0.0", () => {
      expect(supportsAgentFlag({ version: "18.3.1" })).toBe(false);
      expect(supportsAgentFlag({ version: "18.2.0" })).toBe(false);
      expect(supportsAgentFlag({ version: "12.1.0" })).toBe(false);
      expect(supportsAgentFlag({ version: "1.0.0" })).toBe(false);
    });

    it("should return true for versions >= 19.0.0", () => {
      expect(supportsAgentFlag({ version: "19.0.0" })).toBe(true);
      expect(supportsAgentFlag({ version: "19.0.1" })).toBe(true);
      expect(supportsAgentFlag({ version: "19.1.0" })).toBe(true);
      expect(supportsAgentFlag({ version: "20.0.0" })).toBe(true);
      expect(supportsAgentFlag({ version: "100.0.0" })).toBe(true);
    });

    it("should return false for prerelease versions of 19.0.0 (semver behavior)", () => {
      // In semver, 19.0.0-beta.1 < 19.0.0, so prereleases don't support the flag
      // This is the safe/conservative behavior
      expect(supportsAgentFlag({ version: "19.0.0-beta.1" })).toBe(false);
      expect(supportsAgentFlag({ version: "19.0.0-alpha.1" })).toBe(false);
    });

    it("should return true for prerelease versions of 19.0.1+", () => {
      // Prereleases of versions > 19.0.0 should work
      expect(supportsAgentFlag({ version: "19.0.1-beta.1" })).toBe(true);
      expect(supportsAgentFlag({ version: "19.1.0-alpha.1" })).toBe(true);
    });

    it("should return false for invalid version strings (fail-safe)", () => {
      expect(supportsAgentFlag({ version: "invalid" })).toBe(false);
      expect(supportsAgentFlag({ version: "" })).toBe(false);
      expect(supportsAgentFlag({ version: "abc.def.ghi" })).toBe(false);
    });
  });

  describe("hasExistingInstallation", () => {
    let tempDir: string;
    let originalCwd: () => string;
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
      CONFIG_PATH = getConfigPath({ installDir: tempDir });

      // Clean up any existing files in temp dir
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

    it("should return false when config does not exist", () => {
      expect(hasExistingInstallation({ installDir: tempDir })).toBe(false);
    });

    it("should return true when config file exists", () => {
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
