/**
 * Tests for update check orchestrator
 *
 * Tests the main entry point that coordinates version checking,
 * prompt display, and update execution.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";

import { checkForUpdateAndPrompt } from "./checkForUpdate.js";

// Mock the prompt module to avoid actual readline interaction
vi.mock("./updatePrompt.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    showUpdatePrompt: vi.fn().mockResolvedValue("skip" as const),
  };
});

// Mock installTracking to prevent disk reads to the real install state
vi.mock("@/cli/installTracking.js", () => ({
  readInstallState: vi.fn().mockResolvedValue({ install_source: "npm" }),
  buildCLIEventParams: vi.fn().mockResolvedValue({}),
  getUserId: vi.fn().mockResolvedValue(null),
  sendAnalyticsEvent: vi.fn(),
}));

describe("checkForUpdate", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let fetchSpy: MockInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-for-update-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    fs.mkdirSync(path.join(tempDir, ".nori", "profiles"), { recursive: true });

    fetchSpy = vi.spyOn(globalThis, "fetch");
    // Suppress error logging during tests
    vi.spyOn(console, "error").mockImplementation(/* noop */ () => undefined);
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should not prompt when autoupdate is disabled", async () => {
    // Write cache with available update
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

    const { showUpdatePrompt } = await import("./updatePrompt.js");

    await checkForUpdateAndPrompt({
      currentVersion: "1.0.0",
      isInteractive: true,
      isSilent: false,
      autoupdate: "disabled",
    });

    expect(showUpdatePrompt).not.toHaveBeenCalled();
  });

  it("should not prompt when silent mode is on", async () => {
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

    const { showUpdatePrompt } = await import("./updatePrompt.js");

    await checkForUpdateAndPrompt({
      currentVersion: "1.0.0",
      isInteractive: true,
      isSilent: true,
      autoupdate: null,
    });

    expect(showUpdatePrompt).not.toHaveBeenCalled();
  });

  it("should not prompt when no update is available", async () => {
    // Cache with same version
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

    const { showUpdatePrompt } = await import("./updatePrompt.js");

    await checkForUpdateAndPrompt({
      currentVersion: "1.0.0",
      isInteractive: true,
      isSilent: false,
      autoupdate: null,
    });

    expect(showUpdatePrompt).not.toHaveBeenCalled();
  });

  it("should not prompt when current version is 0.0.0", async () => {
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

    const { showUpdatePrompt } = await import("./updatePrompt.js");

    await checkForUpdateAndPrompt({
      currentVersion: "0.0.0",
      isInteractive: true,
      isSilent: false,
      autoupdate: null,
    });

    expect(showUpdatePrompt).not.toHaveBeenCalled();
  });

  it("should trigger background refresh on stale cache", async () => {
    // Write stale cache
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
        last_checked_at: new Date(
          Date.now() - 25 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ version: "2.0.0" }), { status: 200 }),
    );

    await checkForUpdateAndPrompt({
      currentVersion: "1.0.0",
      isInteractive: true,
      isSilent: false,
      autoupdate: null,
    });

    // Wait for background refresh to complete
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it("should write dismissed_version to cache when user chooses dismiss", async () => {
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

    const { showUpdatePrompt } = await import("./updatePrompt.js");
    vi.mocked(showUpdatePrompt).mockResolvedValueOnce("dismiss");

    await checkForUpdateAndPrompt({
      currentVersion: "1.0.0",
      isInteractive: true,
      isSilent: false,
      autoupdate: null,
    });

    // Verify dismissed_version was written to cache
    const updatedCache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    expect(updatedCache.dismissed_version).toBe("2.0.0");
  });

  it("should show prompt when update is available", async () => {
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

    const { showUpdatePrompt } = await import("./updatePrompt.js");
    vi.mocked(showUpdatePrompt).mockResolvedValueOnce("skip");

    await checkForUpdateAndPrompt({
      currentVersion: "1.0.0",
      isInteractive: true,
      isSilent: false,
      autoupdate: null,
    });

    expect(showUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        isInteractive: true,
      }),
    );
  });

  it("should not throw on any failure", async () => {
    // Corrupt cache
    const cachePath = path.join(
      tempDir,
      ".nori",
      "profiles",
      "nori-skillsets-version.json",
    );
    fs.writeFileSync(cachePath, "invalid json{{{");

    await expect(
      checkForUpdateAndPrompt({
        currentVersion: "1.0.0",
        isInteractive: true,
        isSilent: false,
        autoupdate: null,
      }),
    ).resolves.not.toThrow();
  });
});
