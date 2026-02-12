/**
 * Tests for update-check SessionStart hook
 *
 * This hook checks the version cache at session start and
 * outputs a systemMessage if an update is available.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { main } from "./update-check.js";

// Capture console output
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

// Mock analytics to prevent actual tracking
vi.mock("@/cli/installTracking.js", () => ({
  buildCLIEventParams: vi.fn().mockResolvedValue({}),
  getUserId: vi.fn().mockResolvedValue(null),
  sendAnalyticsEvent: vi.fn(),
}));

describe("update-check hook", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-check-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    fs.mkdirSync(path.join(tempDir, ".nori", "profiles"), { recursive: true });

    consoleOutput = [];
    console.log = (...args: Array<unknown>) => {
      consoleOutput.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    console.log = originalConsoleLog;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should output nothing when no version cache exists", async () => {
    // Create config so findInstallDir succeeds
    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "1.0.0" }));

    await main({ installDir: tempDir });
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when no config exists (no installed version)", async () => {
    // Write version cache with update available
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest_version: "2.0.0",
        last_checked_at: new Date().toISOString(),
      }),
    );

    // No config file means readConfig returns null
    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should output systemMessage when update is available", async () => {
    // Write version cache
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest_version: "2.0.0",
        last_checked_at: new Date().toISOString(),
      }),
    );

    // Write config with installed version
    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "1.0.0" }));

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("1.0.0");
    expect(output.systemMessage).toContain("2.0.0");
  });

  it("should output nothing when versions are equal", async () => {
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest_version: "1.0.0",
        last_checked_at: new Date().toISOString(),
      }),
    );

    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "1.0.0" }));

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when update is dismissed", async () => {
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest_version: "2.0.0",
        last_checked_at: new Date().toISOString(),
        dismissed_version: "2.0.0",
      }),
    );

    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "1.0.0" }));

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when autoupdate is disabled", async () => {
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest_version: "2.0.0",
        last_checked_at: new Date().toISOString(),
      }),
    );

    const configPath = path.join(tempDir, ".nori-config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: "1.0.0", autoupdate: "disabled" }),
    );

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should not throw on any error", async () => {
    // Corrupt cache
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(cachePath, "invalid{{{");

    await expect(main()).resolves.not.toThrow();
  });
});
