/**
 * Tests for onboarding wizard welcome hook
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./onboarding-wizard-welcome.js";

// Store console output
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

// Mock analytics to prevent actual tracking
vi.mock("@/cli/analytics.js", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("onboarding-wizard-welcome hook", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "onboarding-wizard-test-"));

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

  it("should output welcome message when profile is onboarding-wizard-questionnaire", async () => {
    // Setup: Create installation with onboarding-wizard-questionnaire profile
    const installDir = path.join(tempDir, "project");
    fs.mkdirSync(installDir, { recursive: true });

    fs.writeFileSync(
      path.join(installDir, ".nori-config.json"),
      JSON.stringify({
        agents: {
          "claude-code": {
            profile: { baseProfile: "onboarding-wizard-questionnaire" },
          },
        },
        installDir: path.join(installDir, ".claude"),
      }),
    );

    // Run the hook
    await main({ installDir });

    // Verify JSON output with systemMessage
    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("Welcome");
    expect(output.systemMessage).toContain("Profile Setup Wizard");
    expect(output.systemMessage).toContain("Just type anything");
  });

  it("should output nothing when profile is senior-swe", async () => {
    // Setup: Create installation with senior-swe profile
    const installDir = path.join(tempDir, "project");
    fs.mkdirSync(installDir, { recursive: true });

    fs.writeFileSync(
      path.join(installDir, ".nori-config.json"),
      JSON.stringify({
        agents: {
          "claude-code": {
            profile: { baseProfile: "senior-swe" },
          },
        },
        installDir: path.join(installDir, ".claude"),
      }),
    );

    // Run the hook
    await main({ installDir });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when no profile is set", async () => {
    // Setup: Create installation without profile
    const installDir = path.join(tempDir, "project");
    fs.mkdirSync(installDir, { recursive: true });

    fs.writeFileSync(
      path.join(installDir, ".nori-config.json"),
      JSON.stringify({
        installDir: path.join(installDir, ".claude"),
      }),
    );

    // Run the hook
    await main({ installDir });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when no installation exists", async () => {
    // Setup: No .nori-config.json
    const installDir = path.join(tempDir, "nonexistent");

    // Run the hook
    await main({ installDir });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should not throw errors and exit gracefully", async () => {
    // Setup: Invalid config path
    const invalidDir = path.join(tempDir, "nonexistent", "path");

    // Run the hook - should not throw
    await expect(main({ installDir: invalidDir })).resolves.not.toThrow();

    // Hook should exit gracefully with no output
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing for other profiles like amol", async () => {
    // Setup: Create installation with amol profile
    const installDir = path.join(tempDir, "project");
    fs.mkdirSync(installDir, { recursive: true });

    fs.writeFileSync(
      path.join(installDir, ".nori-config.json"),
      JSON.stringify({
        agents: {
          "claude-code": {
            profile: { baseProfile: "amol" },
          },
        },
        installDir: path.join(installDir, ".claude"),
      }),
    );

    // Run the hook
    await main({ installDir });

    // Verify no output
    expect(consoleOutput).toHaveLength(0);
  });
});
