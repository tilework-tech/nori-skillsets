/**
 * Tests for version cache module
 *
 * The version cache stores the latest known npm version locally
 * to avoid blocking on network requests.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  readVersionCache,
  writeVersionCache,
  isCacheStale,
  dismissVersion,
  getVersionCachePath,
  type VersionCache,
} from "./versionCache.js";

describe("versionCache", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "version-cache-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Create the cache directory
    fs.mkdirSync(path.join(tempDir, ".nori", "profiles"), { recursive: true });
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getVersionCachePath", () => {
    it("should return path under ~/.nori/profiles/", () => {
      const cachePath = getVersionCachePath();
      expect(cachePath).toContain(path.join(".nori", "profiles"));
      expect(cachePath).toContain("nori-skillsets-version.json");
    });
  });

  describe("readVersionCache", () => {
    it("should return null when cache file does not exist", async () => {
      const result = await readVersionCache();
      expect(result).toBeNull();
    });

    it("should return parsed cache when file exists", async () => {
      const cache: VersionCache = {
        latest_version: "2.0.0",
        last_checked_at: new Date().toISOString(),
      };
      const cachePath = getVersionCachePath();
      fs.writeFileSync(cachePath, JSON.stringify(cache));

      const result = await readVersionCache();
      expect(result).not.toBeNull();
      expect(result!.latest_version).toBe("2.0.0");
    });

    it("should return null when file contains invalid JSON", async () => {
      const cachePath = getVersionCachePath();
      fs.writeFileSync(cachePath, "not valid json{{{");

      const result = await readVersionCache();
      expect(result).toBeNull();
    });
  });

  describe("writeVersionCache", () => {
    it("should write cache to disk", async () => {
      const cache: VersionCache = {
        latest_version: "3.0.0",
        last_checked_at: new Date().toISOString(),
      };

      await writeVersionCache({ cache });

      const cachePath = getVersionCachePath();
      const content = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(content.latest_version).toBe("3.0.0");
    });

    it("should create directory if it does not exist", async () => {
      // Remove the directory
      fs.rmSync(path.join(tempDir, ".nori"), { recursive: true, force: true });

      const cache: VersionCache = {
        latest_version: "1.0.0",
        last_checked_at: new Date().toISOString(),
      };

      await writeVersionCache({ cache });

      const cachePath = getVersionCachePath();
      expect(fs.existsSync(cachePath)).toBe(true);
    });
  });

  describe("isCacheStale", () => {
    it("should return true when cache is null", () => {
      expect(isCacheStale({ cache: null })).toBe(true);
    });

    it("should return true when last_checked_at is older than maxAgeHours", () => {
      const twentyOneHoursAgo = new Date(
        Date.now() - 21 * 60 * 60 * 1000,
      ).toISOString();
      const cache: VersionCache = {
        latest_version: "1.0.0",
        last_checked_at: twentyOneHoursAgo,
      };
      expect(isCacheStale({ cache })).toBe(true);
    });

    it("should return false when last_checked_at is within maxAgeHours", () => {
      const oneHourAgo = new Date(
        Date.now() - 1 * 60 * 60 * 1000,
      ).toISOString();
      const cache: VersionCache = {
        latest_version: "1.0.0",
        last_checked_at: oneHourAgo,
      };
      expect(isCacheStale({ cache })).toBe(false);
    });

    it("should respect custom maxAgeHours", () => {
      const threeHoursAgo = new Date(
        Date.now() - 3 * 60 * 60 * 1000,
      ).toISOString();
      const cache: VersionCache = {
        latest_version: "1.0.0",
        last_checked_at: threeHoursAgo,
      };
      // With 2-hour max age, 3 hours ago is stale
      expect(isCacheStale({ cache, maxAgeHours: 2 })).toBe(true);
      // With 4-hour max age, 3 hours ago is fresh
      expect(isCacheStale({ cache, maxAgeHours: 4 })).toBe(false);
    });

    it("should return true when last_checked_at is invalid", () => {
      const cache: VersionCache = {
        latest_version: "1.0.0",
        last_checked_at: "not-a-date",
      };
      expect(isCacheStale({ cache })).toBe(true);
    });
  });

  describe("dismissVersion", () => {
    it("should set dismissed_version in cache", async () => {
      const cache: VersionCache = {
        latest_version: "2.0.0",
        last_checked_at: new Date().toISOString(),
      };
      const cachePath = getVersionCachePath();
      fs.writeFileSync(cachePath, JSON.stringify(cache));

      await dismissVersion({ version: "2.0.0" });

      const updated = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(updated.dismissed_version).toBe("2.0.0");
      // Should preserve other fields
      expect(updated.latest_version).toBe("2.0.0");
    });

    it("should do nothing if cache does not exist", async () => {
      // Should not throw
      await dismissVersion({ version: "2.0.0" });
    });
  });
});
