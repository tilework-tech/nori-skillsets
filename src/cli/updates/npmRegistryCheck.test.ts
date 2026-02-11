/**
 * Tests for npm registry check module
 *
 * Checks npm registry for latest version and manages the
 * stale-while-revalidate cache pattern.
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

import {
  fetchLatestVersionFromNpm,
  getAvailableUpdate,
  refreshVersionCache,
} from "./npmRegistryCheck.js";

describe("npmRegistryCheck", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let fetchSpy: MockInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "npm-registry-check-test-"),
    );
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    fs.mkdirSync(path.join(tempDir, ".nori", "profiles"), { recursive: true });

    // Mock global fetch
    fetchSpy = vi.spyOn(globalThis, "fetch");
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

  describe("fetchLatestVersionFromNpm", () => {
    it("should return version from npm registry response", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "2.5.0" }), { status: 200 }),
      );

      const result = await fetchLatestVersionFromNpm();
      expect(result).toBe("2.5.0");
    });

    it("should return null on network error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("network error"));

      const result = await fetchLatestVersionFromNpm();
      expect(result).toBeNull();
    });

    it("should return null on non-200 response", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("not found", { status: 404 }),
      );

      const result = await fetchLatestVersionFromNpm();
      expect(result).toBeNull();
    });

    it("should return null on malformed JSON", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("not json{{{", { status: 200 }),
      );

      const result = await fetchLatestVersionFromNpm();
      expect(result).toBeNull();
    });

    it("should return null when response has no version field", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "foo" }), { status: 200 }),
      );

      const result = await fetchLatestVersionFromNpm();
      expect(result).toBeNull();
    });
  });

  describe("getAvailableUpdate", () => {
    it("should return null when no cache exists", async () => {
      const result = await getAvailableUpdate({
        currentVersion: "1.0.0",
      });
      expect(result).toBeNull();
    });

    it("should return latest version when update is available", async () => {
      // Write a cache file with newer version
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

      const result = await getAvailableUpdate({
        currentVersion: "1.0.0",
      });
      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("2.0.0");
    });

    it("should return null when current version equals latest", async () => {
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

      const result = await getAvailableUpdate({
        currentVersion: "1.0.0",
      });
      expect(result).toBeNull();
    });

    it("should return null when latest version is dismissed", async () => {
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

      const result = await getAvailableUpdate({
        currentVersion: "1.0.0",
      });
      expect(result).toBeNull();
    });

    it("should return update when dismissed version differs from latest", async () => {
      const cachePath = path.join(
        tempDir,
        ".nori",
        "profiles",
        "nori-skillsets-version.json",
      );
      fs.writeFileSync(
        cachePath,
        JSON.stringify({
          latest_version: "3.0.0",
          last_checked_at: new Date().toISOString(),
          dismissed_version: "2.0.0",
        }),
      );

      const result = await getAvailableUpdate({
        currentVersion: "1.0.0",
      });
      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("3.0.0");
    });

    it("should return null when currentVersion is 0.0.0 (development)", async () => {
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

      const result = await getAvailableUpdate({
        currentVersion: "0.0.0",
      });
      expect(result).toBeNull();
    });

    it("should filter out prerelease versions from npm", async () => {
      const cachePath = path.join(
        tempDir,
        ".nori",
        "profiles",
        "nori-skillsets-version.json",
      );
      fs.writeFileSync(
        cachePath,
        JSON.stringify({
          latest_version: "2.0.0-beta.1",
          last_checked_at: new Date().toISOString(),
        }),
      );

      const result = await getAvailableUpdate({
        currentVersion: "1.0.0",
      });
      expect(result).toBeNull();
    });
  });

  describe("refreshVersionCache", () => {
    it("should fetch from npm and write cache when stale", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "2.0.0" }), { status: 200 }),
      );

      await refreshVersionCache();

      const cachePath = path.join(
        tempDir,
        ".nori",
        "profiles",
        "nori-skillsets-version.json",
      );
      expect(fs.existsSync(cachePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(content.latest_version).toBe("2.0.0");
    });

    it("should not fetch when cache is fresh", async () => {
      // Write a fresh cache
      const cachePath = path.join(
        tempDir,
        ".nori",
        "profiles",
        "nori-skillsets-version.json",
      );
      fs.writeFileSync(
        cachePath,
        JSON.stringify({
          latest_version: "1.5.0",
          last_checked_at: new Date().toISOString(),
        }),
      );

      await refreshVersionCache();

      // fetch should not have been called
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should not throw on fetch failure", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("network error"));

      await expect(refreshVersionCache()).resolves.not.toThrow();
    });

    it("should preserve dismissed_version when refreshing", async () => {
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
          dismissed_version: "1.0.0",
        }),
      );

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "2.0.0" }), { status: 200 }),
      );

      await refreshVersionCache();

      const content = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(content.latest_version).toBe("2.0.0");
      expect(content.dismissed_version).toBe("1.0.0");
    });
  });
});
