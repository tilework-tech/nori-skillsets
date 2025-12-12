/**
 * Tests for migration instructions hook
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./migration-instructions.js";

// Store console output
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

// Mock analytics to prevent actual tracking
vi.mock("@/cli/analytics.js", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("migration-instructions hook", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-hook-test-"));

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

  it("should output nothing when no migrations are registered", async () => {
    // Setup: Create install directory
    const installDir = path.join(tempDir, "project");
    fs.mkdirSync(path.join(installDir, ".claude"), { recursive: true });

    // Create nori config
    fs.writeFileSync(
      path.join(installDir, ".nori-config.json"),
      JSON.stringify({ profile: { baseProfile: "test" } }),
    );

    // Run the hook
    await main({ installDir });

    // Verify no output (no migrations registered)
    expect(consoleOutput).toHaveLength(0);
  });

  it("should not throw errors and exit gracefully on filesystem errors", async () => {
    // Setup: Invalid config path that would cause an error
    const invalidDir = path.join(tempDir, "nonexistent", "path");

    // Run the hook - should not throw
    await expect(main({ installDir: invalidDir })).resolves.not.toThrow();

    // Hook should exit gracefully with no output
    expect(consoleOutput).toHaveLength(0);
  });
});
