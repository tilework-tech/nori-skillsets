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

    // Create stub profile (built-in profiles no longer bundled)
    const noriProfilesDir = path.join(
      tempDir,
      ".nori",
      "profiles",
      "senior-swe",
    );
    fs.mkdirSync(noriProfilesDir, { recursive: true });
    fs.writeFileSync(path.join(noriProfilesDir, "CLAUDE.md"), "# senior-swe\n");
    fs.writeFileSync(
      path.join(noriProfilesDir, "nori.json"),
      JSON.stringify({
        name: "senior-swe",
        version: "1.0.0",
        description: "Test profile",
      }),
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
        `node build/src/cli/nori-ai.js install --non-interactive --install-dir "${tempDir}" --profile senior-swe`,
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
          `node build/src/cli/nori-ai.js check --install-dir "${tempDir}"`,
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
        "✓ profiles: Profiles directory exists and permissions are configured",
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

  it("should copy cursor-agent slashcommands config files to build", () => {
    // This test verifies that the build script copies cursor-agent slash command
    // markdown files to the build directory. Without this, running
    // `nori-ai install --agent cursor-agent` fails with ENOENT error when
    // the loader tries to read from the config directory.

    const pluginDir = process.cwd();
    const configDir = path.join(
      pluginDir,
      "build/src/cli/features/cursor-agent/slashcommands/config",
    );

    // Check that the config directory exists
    expect(fs.existsSync(configDir)).toBe(true);

    // Check that at least one .md file exists
    const files = fs.readdirSync(configDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles.length).toBeGreaterThan(0);

    // Specifically check for nori-info.md which should always be present
    expect(mdFiles).toContain("nori-info.md");
  });

  it("should register nori-ai and nori-skillsets binaries in package.json", () => {
    // This test verifies that both binaries are registered in package.json
    // with nori-ai pointing to nori-ai.js and nori-skillsets pointing to nori-skillsets.js.
    const pluginDir = process.cwd();
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );

    // Both binaries should be registered
    expect(packageJson.bin).toHaveProperty("nori-ai");
    expect(packageJson.bin).toHaveProperty("nori-skillsets");

    // Each should point to its own CLI entry point
    expect(packageJson.bin["nori-ai"]).toBe("./build/src/cli/nori-ai.js");
    expect(packageJson.bin["nori-skillsets"]).toBe(
      "./build/src/cli/nori-skillsets.js",
    );
  });

  it("should create both nori-ai.js and nori-skillsets.js executables in build", () => {
    // This test verifies that both CLI entry points exist after build
    const pluginDir = process.cwd();

    const noriAiPath = path.join(pluginDir, "build/src/cli/nori-ai.js");
    const noriSkillsetsPath = path.join(
      pluginDir,
      "build/src/cli/nori-skillsets.js",
    );

    // Both files should exist
    expect(fs.existsSync(noriAiPath)).toBe(true);
    expect(fs.existsSync(noriSkillsetsPath)).toBe(true);

    // Both should be executable
    const noriAiStats = fs.statSync(noriAiPath);
    const noriSkillsetsStats = fs.statSync(noriSkillsetsPath);
    expect((noriAiStats.mode & 0o100) !== 0).toBe(true);
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
        output = execSync("node build/src/cli/nori-ai.js", {
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
        output = execSync("node build/src/cli/nori-ai.js install --help", {
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
