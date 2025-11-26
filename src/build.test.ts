/**
 * Tests for build process and CLI verification
 *
 * These tests verify that:
 * 1. The build process completes successfully
 * 2. Build artifacts are correctly generated
 * 3. The CLI works correctly with the built artifacts
 *
 * IMPORTANT: All tests in this file run sequentially because they depend on
 * build artifacts. The build test runs first, then subsequent tests use the
 * generated build/ directory.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe.sequential("build process", () => {
  it("should successfully run npm run build without errors", () => {
    // Run the actual build command from the plugin directory
    // This verifies that:
    // - @types/node is installed (required by tsconfig.json)
    // - TypeScript compilation succeeds
    // - All build steps complete successfully

    // When tests run via vitest, cwd is already the plugin directory
    const pluginDir = process.cwd();

    let stdout = "";
    let stderr = "";
    try {
      const result = execSync("npm run build", {
        cwd: pluginDir,
        encoding: "utf-8",
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      stdout = result;
    } catch (error: unknown) {
      // If build fails, show the error output
      if (error && typeof error === "object") {
        const execError = error as {
          stdout?: string;
          stderr?: string;
          status?: number;
        };
        stdout = execError.stdout || "";
        stderr = execError.stderr || "";
        throw new Error(
          `Build failed with status ${execError.status}:\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
        );
      }
      throw error;
    }

    // Verify build completed successfully
    expect(stdout).toContain("Build Complete");
  });

  it("should successfully run install after build and pass validation", () => {
    // This test verifies that all config files are properly copied during build
    // by actually running the installer after build completes, then running
    // the 'check' command to validate the installation.
    //
    // This catches issues where new features with config directories are added
    // but the build script (scripts/build.sh) is not updated to copy them.

    const pluginDir = process.cwd();

    // Create a temporary directory for the test installation
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nori-install-test-"),
    );

    try {
      // Run the installer pointing to our temp directory
      // Use the CLI entry point (cli.js) with --non-interactive flag
      // to skip prompts and default to free mode
      // CRITICAL: Use --install-dir to ensure installation goes to temp directory
      // Without this flag, installDir defaults to process.cwd() which creates
      // .claude in the project root, breaking test containment
      // Note: We don't check install output - it's expected to succeed
      // The real validation happens with the check command below
      execSync(
        `node build/src/installer/cli.js install --non-interactive --install-dir "${tempDir}"`,
        {
          cwd: pluginDir,
          encoding: "utf-8",
          env: {
            ...process.env,
            FORCE_COLOR: "0",
            HOME: tempDir, // Installer uses HOME to find ~/.claude
          },
        },
      );

      // Run the 'check' command to validate the installation
      // This is much more comprehensive than checking individual files
      // It validates all loaders (skills, profiles, hooks, subagents, etc.)
      // Note: We expect this to fail overall because there's no nori-config.json,
      // but we can still check that all features validated successfully
      let checkOutput = "";
      try {
        checkOutput = execSync(
          `node build/src/installer/cli.js check --install-dir "${tempDir}"`,
          {
            cwd: pluginDir,
            encoding: "utf-8",
            env: {
              ...process.env,
              FORCE_COLOR: "0",
              HOME: tempDir, // Use same temp directory
            },
          },
        );
      } catch (error: unknown) {
        // Check command exits with error due to missing config, but that's OK
        // We can still verify the feature installations from stdout
        if (error && typeof error === "object") {
          const execError = error as { stdout?: string | Buffer };
          checkOutput =
            typeof execError.stdout === "string"
              ? execError.stdout
              : execError.stdout?.toString() || "";
        }
      }

      // Verify all features validated successfully
      // This proves the build script copied all necessary config files
      // Note: skills, claudemd, slashcommands, subagents are now validated via profilesLoader
      expect(checkOutput).toContain("✓ hooks: Hooks are properly configured");
      expect(checkOutput).toContain(
        "✓ profiles: All required profiles are properly installed",
      );
    } catch (error: unknown) {
      if (error && typeof error === "object") {
        const execError = error as {
          stdout?: string | Buffer;
          stderr?: string | Buffer;
          status?: number;
          message?: string;
        };
        const stdout =
          typeof execError.stdout === "string"
            ? execError.stdout
            : execError.stdout?.toString() || "";
        const stderr =
          typeof execError.stderr === "string"
            ? execError.stderr
            : execError.stderr?.toString() || "";
        throw new Error(
          `Installation failed with status ${execError.status}:
Message: ${execError.message || "none"}
STDOUT:
${stdout || "(empty)"}

STDERR:
${stderr || "(empty)"}`,
        );
      }
      throw error;
    } finally {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  describe("skill bundling", () => {
    it("should find and bundle all paid skill scripts", () => {
      // This test verifies that the bundle-skills.ts script correctly discovers
      // all paid skill script.js files in tier-specific mixin directories.
      //
      // Expected: 7 total script files across tier-specific mixins
      // - paid-recall, paid-memorize, paid-prompt-analysis (in _paid)
      // - paid-read-noridoc, paid-write-noridoc, paid-list-noridocs, paid-sync-noridocs (in _docs-paid)

      const pluginDir = process.cwd();
      const buildDir = path.join(pluginDir, "build");

      // Verify build directory exists
      expect(fs.existsSync(buildDir)).toBe(true);

      // Find all paid skill script.js files in tier-specific mixin directories
      const mixinDirs = [
        path.join(
          buildDir,
          "src/installer/features/profiles/config/_mixins/_paid/skills",
        ),
        path.join(
          buildDir,
          "src/installer/features/profiles/config/_mixins/_docs-paid/skills",
        ),
      ];

      let totalScripts = 0;
      const scriptPaths: Array<string> = [];

      for (const skillsDir of mixinDirs) {
        if (fs.existsSync(skillsDir)) {
          const skills = fs.readdirSync(skillsDir);
          for (const skill of skills) {
            if (!skill.startsWith("paid-")) continue;

            const skillPath = path.join(skillsDir, skill);
            const stat = fs.statSync(skillPath);
            if (!stat.isDirectory()) continue;

            const scriptPath = path.join(skillPath, "script.js");
            if (fs.existsSync(scriptPath)) {
              totalScripts++;
              scriptPaths.push(scriptPath);
            }
          }
        }
      }

      // Verify we found the expected number of scripts (3 in _paid + 4 in _docs-paid)
      expect(totalScripts).toBeGreaterThan(0);
      expect(totalScripts).toBe(7); // 7 total paid skills across all tier-specific mixins

      // Verify each script file exists
      for (const scriptPath of scriptPaths) {
        expect(fs.existsSync(scriptPath)).toBe(true);
      }
    });

    it("should bundle scripts to be standalone (no import statements)", () => {
      // This test verifies that bundled scripts have all dependencies inlined
      // and don't contain any import/require statements that would fail at runtime.

      const pluginDir = process.cwd();
      const buildDir = path.join(pluginDir, "build");

      // Find all paid skill script.js files in the _mixins/_paid directory
      const paidSkillsDir = path.join(
        buildDir,
        "src/installer/features/profiles/config/_mixins/_paid/skills",
      );

      const scriptPaths: Array<string> = [];

      if (fs.existsSync(paidSkillsDir)) {
        const skills = fs.readdirSync(paidSkillsDir);
        for (const skill of skills) {
          if (!skill.startsWith("paid-")) continue;

          const skillPath = path.join(paidSkillsDir, skill);
          const stat = fs.statSync(skillPath);
          if (!stat.isDirectory()) continue;

          const scriptPath = path.join(skillPath, "script.js");
          if (fs.existsSync(scriptPath)) {
            scriptPaths.push(scriptPath);
          }
        }
      }

      // Verify we have scripts to test
      expect(scriptPaths.length).toBeGreaterThan(0);

      // Check each bundled script
      for (const scriptPath of scriptPaths) {
        const content = fs.readFileSync(scriptPath, "utf-8");

        // Bundled scripts should NOT contain import statements
        // (except for built-in Node.js modules if needed)
        const importMatches = content.match(/^import\s+.*\s+from\s+['"]/gm);
        const relativeImports = importMatches?.filter(
          (match) =>
            match.includes("from '@/") ||
            match.includes("from '../") ||
            match.includes("from './"),
        );

        // Should have no relative imports (all should be inlined)
        expect(relativeImports || []).toEqual([]);

        // Bundled scripts should NOT contain require() for relative modules
        const requireMatches = content.match(
          /require\(['"](@\/|\.\.\/|\.\/)[^'"]+['"]\)/g,
        );
        expect(requireMatches || []).toEqual([]);
      }
    });

    it("should make bundled scripts executable", () => {
      // This test verifies that bundled scripts have:
      // 1. Execute permissions (chmod +x)
      // 2. A shebang line (#!/usr/bin/env node)

      const pluginDir = process.cwd();
      const buildDir = path.join(pluginDir, "build");

      // Find all paid skill script.js files in the _mixins/_paid directory
      const paidSkillsDir = path.join(
        buildDir,
        "src/installer/features/profiles/config/_mixins/_paid/skills",
      );

      const scriptPaths: Array<string> = [];

      if (fs.existsSync(paidSkillsDir)) {
        const skills = fs.readdirSync(paidSkillsDir);
        for (const skill of skills) {
          if (!skill.startsWith("paid-")) continue;

          const skillPath = path.join(paidSkillsDir, skill);
          const stat = fs.statSync(skillPath);
          if (!stat.isDirectory()) continue;

          const scriptPath = path.join(skillPath, "script.js");
          if (fs.existsSync(scriptPath)) {
            scriptPaths.push(scriptPath);
          }
        }
      }

      // Verify we have scripts to test
      expect(scriptPaths.length).toBeGreaterThan(0);

      // Check each bundled script
      for (const scriptPath of scriptPaths) {
        // Check file permissions (should be executable)
        const stats = fs.statSync(scriptPath);
        const mode = stats.mode;
        // Check if owner has execute permission (0o100)
        const isExecutable = (mode & 0o100) !== 0;
        expect(isExecutable).toBe(true);

        // Check for shebang
        const content = fs.readFileSync(scriptPath, "utf-8");
        const firstLine = content.split("\n")[0];
        expect(firstLine).toMatch(/^#!.*node/);
      }
    });

    it('should not report "No paid skill scripts found" warning', () => {
      // This test verifies that the bundle-skills.ts script successfully finds
      // the paid skill scripts and doesn't output the warning message.

      const pluginDir = process.cwd();

      let stdout = "";
      try {
        stdout = execSync("npm run build", {
          cwd: pluginDir,
          encoding: "utf-8",
          env: { ...process.env, FORCE_COLOR: "0" },
        });
      } catch (error: unknown) {
        if (error && typeof error === "object") {
          const execError = error as { stdout?: string };
          stdout = execError.stdout || "";
        }
        throw error;
      }

      // Should NOT contain the warning about no scripts found
      expect(stdout).not.toContain("No paid skill scripts found to bundle");
      expect(stdout).not.toContain("No scripts found to bundle");

      // Should contain success message about bundling
      expect(stdout).toContain("Bundling Paid Skill Scripts and Hook Scripts");
      expect(stdout).toMatch(/Successfully bundled \d+ script\(s\)/);
    });
  });

  // CLI behavior tests - these run after build tests to ensure build artifacts exist
  describe("CLI behavior", () => {
    let tempDir: string;
    let originalHome: string | undefined;

    beforeEach(() => {
      // Create temp directory for test isolation
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));

      // Mock HOME to prevent installation in real directories
      originalHome = process.env.HOME;
      process.env.HOME = tempDir;
    });

    afterEach(() => {
      // Restore original HOME
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }

      // Clean up temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should show help when no arguments provided", () => {
      // Run the CLI with no arguments
      let output = "";

      try {
        output = execSync("node build/src/installer/cli.js", {
          encoding: "utf-8",
          stdio: "pipe",
          env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
        });
      } catch (error: unknown) {
        // process.exit() will throw, capture the output
        if (error && typeof error === "object") {
          const execError = error as { stdout?: string; stderr?: string };
          output = execError.stdout || execError.stderr || "";
        }
      }

      // Verify that help text is shown
      expect(output).toContain("Usage: nori-ai");
      expect(output).toContain("Options:");
      expect(output).toContain("Commands:");

      // Verify it doesn't try to run install (install would show different output)
      expect(output).not.toContain("Installing Nori Profiles");
    });

    it("should show install help when 'install --help' provided", () => {
      // Just verify the CLI can parse the install command without crashing
      let output = "";

      try {
        // Run with --help on the install command to avoid actual installation
        output = execSync("node build/src/installer/cli.js install --help", {
          encoding: "utf-8",
          stdio: "pipe",
          env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
        });
      } catch (error: unknown) {
        if (error && typeof error === "object") {
          const execError = error as { stdout?: string; stderr?: string };
          output = execError.stdout || execError.stderr || "";
        }
      }

      // Verify the install command is recognized
      expect(output).toContain("install");
    });
  });
});
