/**
 * Version cache module for auto-update checking
 *
 * Stores the latest known npm version locally to avoid blocking
 * on network requests. Uses a stale-while-revalidate pattern.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const VERSION_CACHE_FILE = "nori-skillsets-version.json";
const DEFAULT_MAX_AGE_HOURS = 12;

export type VersionCache = {
  latest_version: string;
  last_checked_at: string;
  dismissed_version?: string | null;
};

/**
 * Get the path to the version cache file.
 * Located alongside .nori-install.json in ~/.nori/profiles/
 *
 * @returns The absolute path to the version cache file
 */
export const getVersionCachePath = (): string => {
  return path.join(os.homedir(), ".nori", "profiles", VERSION_CACHE_FILE);
};

/**
 * Read the version cache from disk.
 *
 * @returns The cached version data, or null if the file doesn't exist or is invalid
 */
export const readVersionCache = async (): Promise<VersionCache | null> => {
  try {
    const content = await fs.readFile(getVersionCachePath(), "utf-8");
    return JSON.parse(content) as VersionCache;
  } catch {
    return null;
  }
};

/**
 * Write the version cache to disk.
 * Creates the directory if it doesn't exist.
 *
 * @param args - Arguments
 * @param args.cache - The cache object to write
 */
export const writeVersionCache = async (args: {
  cache: VersionCache;
}): Promise<void> => {
  const { cache } = args;
  const cachePath = getVersionCachePath();
  const dirPath = path.dirname(cachePath);

  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
};

/**
 * Check if the version cache is stale.
 *
 * @param args - Arguments
 * @param args.cache - The cache to check (null = stale)
 * @param args.maxAgeHours - Max age in hours before cache is stale (default: 20)
 *
 * @returns True if the cache is stale or null
 */
export const isCacheStale = (args: {
  cache: VersionCache | null;
  maxAgeHours?: number | null;
}): boolean => {
  const { cache, maxAgeHours } = args;
  const maxAge = maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;

  if (cache == null) {
    return true;
  }

  const lastChecked = new Date(cache.last_checked_at).getTime();
  if (isNaN(lastChecked)) {
    return true;
  }

  const ageMs = Date.now() - lastChecked;
  const maxAgeMs = maxAge * 60 * 60 * 1000;

  return ageMs > maxAgeMs;
};

/**
 * Dismiss a version so the update prompt won't show for it.
 *
 * @param args - Arguments
 * @param args.version - The version to dismiss
 */
export const dismissVersion = async (args: {
  version: string;
}): Promise<void> => {
  const { version } = args;
  const cache = await readVersionCache();
  if (cache == null) {
    return;
  }

  cache.dismissed_version = version;
  await writeVersionCache({ cache });
};
