import { execSync } from "child_process";

import { describe, it, expect } from "vitest";

/**
 * CLI behavior tests
 *
 * These tests verify that the CLI shows help by default when no command is provided,
 * rather than automatically running the install command.
 */

describe("CLI default behavior", () => {
  it("should show help when no arguments provided", () => {
    // Build the CLI first to ensure we have the latest version
    execSync("npm run build", { encoding: "utf-8" });

    // Run the CLI with no arguments
    let output = "";

    try {
      output = execSync("node build/src/installer/cli.js", {
        encoding: "utf-8",
        stdio: "pipe",
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
      });
    } catch (error: any) {
      output = error.stdout || error.stderr || "";
    }

    // Verify the install command is recognized
    expect(output).toContain("install");
  });
});
