/**
 * Tests for update-check SessionStart hook
 *
 * This hook compares the running CLI version (from getCurrentPackageVersion)
 * against the latest version stored in the version cache, and outputs a
 * systemMessage if an update is available.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type * as versionModule from "@/cli/version.js";

import { main } from "./update-check.js";

// Mock analytics to prevent actual tracking
vi.mock("@/cli/installTracking.js", () => ({
  buildCLIEventParams: vi.fn().mockResolvedValue({}),
  getUserId: vi.fn().mockResolvedValue(null),
  sendAnalyticsEvent: vi.fn(),
}));

// Mock getCurrentPackageVersion so we can drive "running CLI version"
const getCurrentPackageVersionMock = vi.fn<() => string | null>();
vi.mock("@/cli/version.js", async (importOriginal) => {
  const actual = await importOriginal<typeof versionModule>();
  return {
    ...actual,
    getCurrentPackageVersion: () => getCurrentPackageVersionMock(),
  };
});

// Capture console output
let consoleOutput: Array<string> = [];
const originalConsoleLog = console.log;

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

    getCurrentPackageVersionMock.mockReset();
    // Default: running CLI is at 1.0.0
    getCurrentPackageVersionMock.mockReturnValue("1.0.0");
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
    await main({ installDir: tempDir });
    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when running CLI version is unknown", async () => {
    getCurrentPackageVersionMock.mockReturnValue(null);
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

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should output systemMessage when running version is older than latest", async () => {
    getCurrentPackageVersionMock.mockReturnValue("1.0.0");
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

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(1);
    const output = JSON.parse(consoleOutput[0]);
    expect(output).toHaveProperty("systemMessage");
    expect(output.systemMessage).toContain("1.0.0");
    expect(output.systemMessage).toContain("2.0.0");
  });

  it("should output nothing when versions are equal", async () => {
    getCurrentPackageVersionMock.mockReturnValue("1.0.0");
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

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when update is dismissed", async () => {
    getCurrentPackageVersionMock.mockReturnValue("1.0.0");
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

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when autoupdate is disabled", async () => {
    getCurrentPackageVersionMock.mockReturnValue("1.0.0");
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
    fs.writeFileSync(configPath, JSON.stringify({ autoupdate: "disabled" }));

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should output nothing when running version is -next of latest", async () => {
    getCurrentPackageVersionMock.mockReturnValue("0.6.3-next.1");
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        latest_version: "0.6.3",
        last_checked_at: new Date().toISOString(),
      }),
    );

    await main({ installDir: tempDir });

    expect(consoleOutput).toHaveLength(0);
  });

  it("should not throw on any error", async () => {
    getCurrentPackageVersionMock.mockReturnValue("1.0.0");
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
