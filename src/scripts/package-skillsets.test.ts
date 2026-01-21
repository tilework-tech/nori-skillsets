/**
 * Tests for scripts/package-skillsets.sh
 *
 * These tests verify the packaging script that creates the nori-skillsets npm package:
 * 1. Creates a staging directory with the correct structure
 * 2. Generates a proper package.json for nori-skillsets
 * 3. Includes the seaweed CLI entry point
 * 4. Creates a valid npm tarball
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("scripts/package-skillsets.sh", () => {
  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, "scripts", "package-skillsets.sh");

  describe("file structure", () => {
    it("should be executable", () => {
      fs.accessSync(scriptPath, fs.constants.X_OK);
    });
  });
});

describe("package-skillsets.sh execution", () => {
  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, "scripts", "package-skillsets.sh");
  const distDir = path.join(projectRoot, "dist");
  const stagingDir = path.join(distDir, "nori-skillsets-staging");

  beforeAll(() => {
    // Clean up any previous test artifacts
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }

    // Run the packaging script
    execSync(`bash ${scriptPath}`, {
      cwd: projectRoot,
      stdio: "pipe",
      env: { ...process.env, SKILLSETS_VERSION: "1.0.0-test" },
    });
  });

  afterAll(() => {
    // Clean up test artifacts
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  describe("staging directory", () => {
    it("should create staging directory", () => {
      expect(fs.existsSync(stagingDir)).toBe(true);
    });

    it("should contain build directory", () => {
      const buildDir = path.join(stagingDir, "build");
      expect(fs.existsSync(buildDir)).toBe(true);
    });

    it("should contain seaweed.js entry point", () => {
      const seaweedPath = path.join(
        stagingDir,
        "build",
        "src",
        "cli",
        "seaweed.js",
      );
      expect(fs.existsSync(seaweedPath)).toBe(true);
    });
  });

  describe("generated package.json", () => {
    it("should exist in staging directory", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      expect(fs.existsSync(packageJsonPath)).toBe(true);
    });

    it("should have name nori-skillsets", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.name).toBe("nori-skillsets");
    });

    it("should have correct bin entries", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.bin).toBeDefined();
      expect(packageJson.bin["seaweed"]).toBe("./build/src/cli/seaweed.js");
      expect(packageJson.bin["nori-skillsets"]).toBe(
        "./build/src/cli/seaweed.js",
      );
    });

    it("should have type module", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.type).toBe("module");
    });

    it("should include required dependencies", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.dependencies).toBeDefined();
      // Core dependencies needed by seaweed
      expect(packageJson.dependencies["commander"]).toBeDefined();
      expect(packageJson.dependencies["node-fetch"]).toBeDefined();
    });

    it("should use version from environment variable when provided", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.version).toBe("1.0.0-test");
    });
  });

  describe("npm tarball", () => {
    it("should create tarball in dist directory", () => {
      const files = fs.readdirSync(distDir);
      const tarball = files.find(
        (f) => f.startsWith("nori-skillsets-") && f.endsWith(".tgz"),
      );
      expect(tarball).toBeDefined();
    });

    it("should have correct tarball name format", () => {
      const files = fs.readdirSync(distDir);
      const tarball = files.find(
        (f) => f.startsWith("nori-skillsets-") && f.endsWith(".tgz"),
      );
      expect(tarball).toMatch(/^nori-skillsets-\d+\.\d+\.\d+.*\.tgz$/);
    });
  });
});
