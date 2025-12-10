/**
 * Tests for nested installation warning hook
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./nested-install-warning.js";

// Store console output
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

// Mock analytics to prevent actual tracking
vi.mock("@/cli/analytics.js", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("nested-install-warning hook", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nested-hook-test-"));

    // Mock HOME
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Capture console output
    consoleOutput = [];
    console.log = (...args: Array<unknown>) => {
      consoleOutput.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Restore console
    console.log = originalConsoleLog;

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should output systemMessage JSON when 2+ ancestor installations exist", async () => {
    // Setup: Create grandparent and parent installations
    const grandparentDir = path.join(tempDir, "grandparent");
    const parentDir = path.join(grandparentDir, "parent");
    const childDir = path.join(parentDir, "child");
    fs.mkdirSync(childDir, { recursive: true });

    // Create nori configs in grandparent and parent
    fs.writeFileSync(
      path.join(grandparentDir, ".nori-config.json"),
      JSON.stringify({ profile: { baseProfile: "test" } }),
    );
    fs.writeFileSync(
      path.join(parentDir, ".nori-config.json"),
      JSON.stringify({ profile: { baseProfile: "test" } }),
    );

    // Create nori config in child (current installation)
    fs.writeFileSync(
      path.join(childDir, ".nori-config.json"),
      JSON.stringify({
        profile: { baseProfile: "test" },
        installDir: path.join(childDir, ".claude"),
      }),
    );

    // Run the hook
    await main({ installDir: path.join(childDir, ".claude") });

    // Verify JSON output with systemMessage
    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("⚠️");
    expect(output.systemMessage).toContain(parentDir);
    expect(output.systemMessage).toContain(grandparentDir);
    expect(output.systemMessage).toContain("nori-ai uninstall");
  });

  it("should output nothing when no ancestor installation exists", async () => {
    // Setup: Create child directory without parent installation
    const childDir = path.join(tempDir, "child");
    fs.mkdirSync(childDir, { recursive: true });

    // Create nori config in child only
    fs.writeFileSync(
      path.join(childDir, ".nori-config.json"),
      JSON.stringify({
        profile: { baseProfile: "test" },
        installDir: path.join(childDir, ".claude"),
      }),
    );

    // Run the hook
    await main({ installDir: path.join(childDir, ".claude") });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should not throw errors and exit gracefully", async () => {
    // Setup: Invalid config path that would cause an error
    const invalidDir = path.join(tempDir, "nonexistent", "path");

    // Run the hook - should not throw
    await expect(
      main({ installDir: path.join(invalidDir, ".claude") }),
    ).resolves.not.toThrow();

    // Hook should exit gracefully with no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should NOT warn when only one ancestor installation exists", async () => {
    // Setup: Only parent has installation
    const parentDir = path.join(tempDir, "parent");
    const childDir = path.join(parentDir, "child");
    fs.mkdirSync(childDir, { recursive: true });

    // Only parent has nori config
    fs.writeFileSync(
      path.join(parentDir, ".nori-config.json"),
      JSON.stringify({ profile: { baseProfile: "test" } }),
    );

    // Run hook from child subdirectory
    await main({ installDir: path.join(childDir, ".claude") });

    // Should NOT warn - only 1 ancestor installation
    expect(consoleOutput).toHaveLength(0);
  });

  it("should warn when current dir AND one ancestor have installations", async () => {
    // Setup: Simulates installation at ~ and ~/foo/bar
    const parentDir = path.join(tempDir, "parent");
    const childDir = path.join(parentDir, "child");
    fs.mkdirSync(childDir, { recursive: true });

    // Create installation in parent (simulating ~)
    fs.writeFileSync(
      path.join(parentDir, ".nori-config.json"),
      JSON.stringify({ profile: { baseProfile: "test" } }),
    );

    // Create installation in child (simulating ~/foo/bar)
    fs.writeFileSync(
      path.join(childDir, ".nori-config.json"),
      JSON.stringify({
        profile: { baseProfile: "test" },
        installDir: path.join(childDir, ".claude"),
      }),
    );

    // Run hook from child directory
    await main({ installDir: path.join(childDir, ".claude") });

    // Should warn - 2 total installations
    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("⚠️");
    expect(output.systemMessage).toContain("Nested Nori Installation");
    // Should show both installation locations
    expect(output.systemMessage).toContain(parentDir);
    expect(output.systemMessage).toContain(childDir);
  });
});
