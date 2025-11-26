/**
 * Tests for version loader
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock env module before importing
vi.mock("@/installer/env.js", () => {
  const testRoot = "/tmp/version-loader-test-mcp-root";
  return {
    MCP_ROOT: testRoot,
  };
});

import { MCP_ROOT } from "@/installer/env.js";
import { getVersionFilePath } from "@/installer/version.js";

import type { Config } from "@/installer/config.js";

import { versionLoader } from "./loader.js";

describe("versionLoader", () => {
  let tempDir: string;
  const testPackageJsonPath = path.join(MCP_ROOT, "package.json");

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "version-loader-test-"));

    // Ensure MCP_ROOT exists and create test package.json
    if (!fs.existsSync(MCP_ROOT)) {
      fs.mkdirSync(MCP_ROOT, { recursive: true });
    }

    const testPackage = {
      name: "nori-ai",
      version: "16.0.0",
    };
    fs.writeFileSync(testPackageJsonPath, JSON.stringify(testPackage));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Clean up test package.json
    try {
      fs.unlinkSync(testPackageJsonPath);
    } catch {
      // Ignore if doesn't exist
    }
  });

  describe("run", () => {
    it("should create version file with current package version", async () => {
      const config: Config = { installDir: tempDir };

      await versionLoader.run({ config });

      const versionFile = getVersionFilePath({ installDir: tempDir });
      expect(fs.existsSync(versionFile)).toBe(true);

      const version = fs.readFileSync(versionFile, "utf-8").trim();
      // Version should be a valid semver string
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("should overwrite existing version file", async () => {
      const config: Config = { installDir: tempDir };
      const versionFile = getVersionFilePath({ installDir: tempDir });

      // Create old version file
      fs.writeFileSync(versionFile, "0.0.1", "utf-8");

      await versionLoader.run({ config });

      const version = fs.readFileSync(versionFile, "utf-8").trim();
      expect(version).not.toBe("0.0.1");
    });
  });

  describe("uninstall", () => {
    it("should remove version file", async () => {
      const config: Config = { installDir: tempDir };
      const versionFile = getVersionFilePath({ installDir: tempDir });

      // Create version file
      fs.writeFileSync(versionFile, "1.0.0", "utf-8");

      await versionLoader.uninstall({ config });

      expect(fs.existsSync(versionFile)).toBe(false);
    });

    it("should handle missing version file gracefully", async () => {
      const config: Config = { installDir: tempDir };

      // Should not throw
      await expect(versionLoader.uninstall({ config })).resolves.not.toThrow();
    });
  });
});
