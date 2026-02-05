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
 *
 * WARNING: This test file modifies the shared build/ directory by running
 * `npm run build`. If other tests depend on build artifacts, they will fail
 * if run in parallel with this file.
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

  it("should successfully run init after build", () => {
    // This test verifies that all config files are properly copied during build
    // by actually running the init command after build completes.
    //
    // This catches issues where new features with config directories are added
    // but the build script (scripts/build.sh) is not updated to copy them.

    const pluginDir = process.cwd();

    // Create a temporary directory for the test installation
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nori-install-test-"),
    );

    try {
      // Run the init command pointing to our temp directory
      // CRITICAL: Use --install-dir to ensure installation goes to temp directory
      execSync(
        `node build/src/cli/nori-skillsets.js init --non-interactive --install-dir "${tempDir}"`,
        {
          cwd: pluginDir,
          encoding: "utf-8",
          env: {
            ...process.env,
            FORCE_COLOR: "0",
            HOME: tempDir,
          },
        },
      );

      // Verify the installation directory was created with expected structure
      const noriDir = path.join(tempDir, ".nori");
      expect(fs.existsSync(noriDir)).toBe(true);
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
          `Init failed with status ${execError.status}:
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

  describe("hook script bundling", () => {
    it("should not contain paid- prefixed skill directories in build", () => {
      // No paid-* prefixed skill directories should exist in any
      // profile's skills directory.

      const pluginDir = process.cwd();
      const buildDir = path.join(pluginDir, "build");
      const profilesDir = path.join(
        buildDir,
        "src/cli/features/claude-code/profiles/config",
      );

      if (fs.existsSync(profilesDir)) {
        const profiles = fs.readdirSync(profilesDir);
        for (const profile of profiles) {
          if (profile.startsWith("_")) continue;

          const skillsDir = path.join(profilesDir, profile, "skills");
          if (!fs.existsSync(skillsDir)) continue;

          const skills = fs.readdirSync(skillsDir);
          const paidSkills = skills.filter((s) => s.startsWith("paid-"));
          expect(paidSkills).toEqual([]);
        }
      }
    });

    it('should not report "No scripts found to bundle" warning', () => {
      // This test verifies that the bundle-skills.ts script successfully finds
      // hook scripts and doesn't output the warning message.

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
      expect(stdout).not.toContain("No scripts found to bundle");

      // Should contain success message about bundling
      expect(stdout).toContain("Bundling Hook Scripts");
      expect(stdout).toContain("Successfully bundled");
    });

    it("should execute bundled hook scripts without dynamic require errors", () => {
      // This test verifies that bundled hook scripts can actually run without
      // crashing with "Dynamic require of 'util' is not supported" errors.
      //
      // The issue: When esbuild bundles CommonJS libraries (like Winston's
      // logform which uses @colors/colors) into ESM format, dynamic require()
      // calls for Node.js builtins fail at runtime.
      //
      // This test executes a bundled hook script to verify it runs cleanly.

      const pluginDir = process.cwd();
      const hookScript = path.join(
        pluginDir,
        "build/src/cli/features/claude-code/hooks/config/commit-author.js",
      );

      // Verify the hook script exists
      expect(fs.existsSync(hookScript)).toBe(true);

      // Execute the hook script with empty stdin
      // The script should exit gracefully without throwing "Dynamic require" error
      let stderr = "";
      let exitCode: number | null = null;

      try {
        execSync(`echo '{}' | node "${hookScript}"`, {
          cwd: pluginDir,
          encoding: "utf-8",
          env: { ...process.env, FORCE_COLOR: "0" },
          timeout: 10000, // 10 second timeout
        });
        exitCode = 0;
      } catch (error: unknown) {
        if (error && typeof error === "object") {
          const execError = error as {
            stderr?: string;
            status?: number;
          };
          stderr = execError.stderr || "";
          exitCode = execError.status ?? 1;
        }
      }

      // The critical check: stderr should NOT contain dynamic require errors
      expect(stderr).not.toContain("Dynamic require of");
      expect(stderr).not.toContain("is not supported");

      // Script should exit cleanly (exit code 0)
      // The commit-author hook exits with 0 even on errors to not crash sessions
      expect(exitCode).toBe(0);
    });
  });

  it("should register nori-skillsets binary in package.json", () => {
    // This test verifies that the nori-skillsets binary is registered in package.json
    const pluginDir = process.cwd();
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );

    // nori-skillsets binary should be registered
    expect(packageJson.bin).toHaveProperty("nori-skillsets");

    // Should point to its CLI entry point
    expect(packageJson.bin["nori-skillsets"]).toBe(
      "./build/src/cli/nori-skillsets.js",
    );
  });

  it("should create nori-skillsets.js executable in build", () => {
    // This test verifies that the CLI entry point exists after build
    const pluginDir = process.cwd();

    const noriSkillsetsPath = path.join(
      pluginDir,
      "build/src/cli/nori-skillsets.js",
    );

    // File should exist
    expect(fs.existsSync(noriSkillsetsPath)).toBe(true);

    // Should be executable
    const noriSkillsetsStats = fs.statSync(noriSkillsetsPath);
    expect((noriSkillsetsStats.mode & 0o100) !== 0).toBe(true);
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
        output = execSync("node build/src/cli/nori-skillsets.js", {
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
      expect(output).toContain("Usage: nori-skillsets");
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
        output = execSync(
          "node build/src/cli/nori-skillsets.js install --help",
          {
            encoding: "utf-8",
            stdio: "pipe",
            env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
          },
        );
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
