/**
 * npm registry check module for auto-update
 *
 * Fetches the latest version from the npm registry and manages
 * the stale-while-revalidate cache pattern.
 */

import semver from "semver";

import {
  readVersionCache,
  writeVersionCache,
  isCacheStale,
  type VersionCache,
} from "@/cli/updates/versionCache.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/nori-skillsets/latest";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch the latest version of nori-skillsets from the npm registry.
 *
 * @returns The latest version string, or null on any failure
 */
export const fetchLatestVersionFromNpm = async (): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const version = data?.version;
    if (typeof version !== "string") {
      return null;
    }

    return version;
  } catch {
    return null;
  }
};

/**
 * Refresh the version cache by checking npm if the cache is stale.
 * Preserves the dismissed_version field when refreshing.
 * Does not throw on failure.
 */
export const refreshVersionCache = async (): Promise<void> => {
  try {
    const existingCache = await readVersionCache();

    if (!isCacheStale({ cache: existingCache })) {
      return;
    }

    const latestVersion = await fetchLatestVersionFromNpm();
    if (latestVersion == null) {
      return;
    }

    const newCache: VersionCache = {
      latest_version: latestVersion,
      last_checked_at: new Date().toISOString(),
      dismissed_version: existingCache?.dismissed_version ?? null,
    };

    await writeVersionCache({ cache: newCache });
  } catch {
    // Silent failure - don't disrupt CLI
  }
};

/**
 * Check if an update is available based on cached version data.
 * Returns null if no update is available or if the update is dismissed.
 * Filters out prerelease versions and 0.0.0 development versions.
 *
 * @param args - Arguments
 * @param args.currentVersion - The currently running version
 *
 * @returns Object with latestVersion if update available, or null
 */
export const getAvailableUpdate = async (args: {
  currentVersion: string;
}): Promise<{ latestVersion: string } | null> => {
  const { currentVersion } = args;

  // Skip update check for development builds
  if (currentVersion === "0.0.0") {
    return null;
  }

  const cache = await readVersionCache();
  if (cache == null) {
    return null;
  }

  const latestVersion = cache.latest_version;

  // Filter out prerelease versions
  if (semver.prerelease(latestVersion) != null) {
    return null;
  }

  // Check if latest is actually newer
  if (
    semver.valid(latestVersion) == null ||
    semver.valid(currentVersion) == null
  ) {
    return null;
  }

  // Treat -next prerelease versions as at least equal to their base version.
  // In semver, 0.6.3-next.1 < 0.6.3, but -next means "subsequent to the
  // release" so users on -next should not be prompted to downgrade.
  const prerelease = semver.prerelease(currentVersion);
  const effectiveCurrentVersion =
    prerelease != null && prerelease[0] === "next"
      ? `${semver.major(currentVersion)}.${semver.minor(currentVersion)}.${semver.patch(currentVersion)}`
      : currentVersion;

  if (!semver.gt(latestVersion, effectiveCurrentVersion)) {
    return null;
  }

  // Check if this version was dismissed
  if (cache.dismissed_version === latestVersion) {
    return null;
  }

  return { latestVersion };
};
