import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";

/**
 * CLI behavior tests
 *
 * These tests verify that the CLI shows help by default when no command is provided,
 * rather than automatically running the install command.
 *
 * Note: These tests run the compiled JavaScript directly from the build directory,
 * so we ensure a fresh build before running tests to avoid stale/corrupt build artifacts.
 */

describe.sequential("CLI default behavior", () => {
  beforeAll(() => {
    // Ensure build is fresh before running CLI tests
    // This is necessary because these tests run the compiled JS directly
    execSync("npm run build", {
      encoding: "utf-8",
      stdio: "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  });

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
    } catch (e) {
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
    } catch (error: any) {
      // process.exit() will throw, capture the output
      output = error.stdout || error.stderr || "";
    }

    // Verify that help text is shown
    expect(output).toContain("Usage: nori-ai");
    expect(output).toContain("Options:");
    expect(output).toContain("Commands:");

    // Verify it doesn't try to run install (install would show different output)
    expect(output).not.toContain("Installing Nori Profiles");
  });

  it("should run install command when 'install' argument provided", () => {
    // This is a placeholder test to ensure we don't break the install command
    // The actual install functionality is tested in install.integration.test.ts

    // Just verify the CLI can parse the install command without crashing
    let output = "";

    try {
      // Run with --help on the install command to avoid actual installation
      output = execSync("node build/src/installer/cli.js install --help", {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir },
      });
    } catch (error: any) {
      output = error.stdout || error.stderr || "";
    }

    // Verify the install command is recognized
    expect(output).toContain("install");
  });
});
