/**
 * Tests for scripts/package_skillsets.sh
 *
 * These tests verify the packaging script that creates the nori-skillsets npm package:
 * 1. Creates a staging directory with the correct structure
 * 2. Generates a proper package.json for nori-skillsets from main package.json
 * 3. Includes the nori-skillsets CLI entry point
 * 4. Creates a valid npm tarball
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("scripts/package_skillsets.sh", () => {
  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, "scripts", "package_skillsets.sh");

  describe("file structure", () => {
    it("should be executable", () => {
      fs.accessSync(scriptPath, fs.constants.X_OK);
    });
  });
});

describe("main package.json", () => {
  const projectRoot = process.cwd();
  const mainPkgPath = path.join(projectRoot, "package.json");

  it("should exist", () => {
    expect(fs.existsSync(mainPkgPath)).toBe(true);
  });

  it("should have name nori-skillsets", () => {
    const pkg = JSON.parse(fs.readFileSync(mainPkgPath, "utf-8"));
    expect(pkg.name).toBe("nori-skillsets");
  });

  it("should have required metadata for publishing", () => {
    const pkg = JSON.parse(fs.readFileSync(mainPkgPath, "utf-8"));
    expect(pkg.description).toBeDefined();
    expect(pkg.license).toBeDefined();
    expect(pkg.author).toBeDefined();
    expect(pkg.repository).toBeDefined();
    expect(pkg.homepage).toBeDefined();
    expect(pkg.engines).toBeDefined();
  });

  it("should have correct bin entry for nori-skillsets", () => {
    const pkg = JSON.parse(fs.readFileSync(mainPkgPath, "utf-8"));
    expect(pkg.bin["nori-skillsets"]).toBe("./build/src/cli/nori-skillsets.js");
  });

  it("should have type module", () => {
    const pkg = JSON.parse(fs.readFileSync(mainPkgPath, "utf-8"));
    expect(pkg.type).toBe("module");
  });

  it("should have core runtime dependencies", () => {
    const pkg = JSON.parse(fs.readFileSync(mainPkgPath, "utf-8"));
    // Core dependencies needed by nori-skillsets
    expect(pkg.dependencies["commander"]).toBeDefined();
    expect(pkg.dependencies["semver"]).toBeDefined();
    expect(pkg.dependencies["winston"]).toBeDefined();
  });
});

describe("package_skillsets.sh execution", () => {
  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, "scripts", "package_skillsets.sh");
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

    it("should contain nori-skillsets.js entry point", () => {
      const noriSkillsetsPath = path.join(
        stagingDir,
        "build",
        "src",
        "cli",
        "nori-skillsets.js",
      );
      expect(fs.existsSync(noriSkillsetsPath)).toBe(true);
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
      expect(packageJson.bin["nori-skillsets"]).toBe(
        "./build/src/cli/nori-skillsets.js",
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
      // Core dependencies needed by nori-skillsets
      expect(packageJson.dependencies["commander"]).toBeDefined();
      expect(packageJson.dependencies["semver"]).toBeDefined();
      expect(packageJson.dependencies["winston"]).toBeDefined();
    });

    it("should use version from environment variable when provided", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.version).toBe("1.0.0-test");
    });

    it("should not include devDependencies", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.devDependencies).toBeUndefined();
    });

    it("should only include lifecycle scripts", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      // Should preserve lifecycle scripts (postinstall) but remove dev scripts
      const allowedScripts = ["preinstall", "install", "postinstall"];
      if (packageJson.scripts) {
        for (const key of Object.keys(packageJson.scripts)) {
          expect(allowedScripts).toContain(key);
        }
      }
      // Dev scripts should not be present
      expect(packageJson.scripts?.build).toBeUndefined();
      expect(packageJson.scripts?.test).toBeUndefined();
      expect(packageJson.scripts?.lint).toBeUndefined();
    });

    it("should include publishing metadata", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      expect(packageJson.license).toBeDefined();
      expect(packageJson.author).toBeDefined();
      expect(packageJson.repository).toBeDefined();
      expect(packageJson.homepage).toBeDefined();
    });

    it("should match dependencies from main package.json", () => {
      const packageJsonPath = path.join(stagingDir, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const mainPkgPath = path.join(projectRoot, "package.json");
      const mainPkg = JSON.parse(fs.readFileSync(mainPkgPath, "utf-8"));

      // Staged package should have same dependencies as main
      expect(Object.keys(packageJson.dependencies).sort()).toEqual(
        Object.keys(mainPkg.dependencies).sort(),
      );
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
