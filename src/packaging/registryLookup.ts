/**
 * Shared registry lookup and formatting helpers for the download commands.
 *
 * These helpers are cli-free: anything that needs cli-layer context (config,
 * command names) is passed in by the caller as plain values or callbacks.
 */

import { NetworkError, REGISTRAR_URL } from "@/api/registrar.js";

import type { Packument } from "@/api/registrar.js";

/**
 * Result of searching for a package in a registry
 */
export type RegistrySearchResult = {
  registryUrl: string;
  packument: Packument;
  authToken?: string | null;
};

/**
 * Error information from a failed search
 */
export type RegistrySearchError = {
  registryUrl: string;
  isNetworkError: boolean;
  message: string;
};

/**
 * Search a specific registry for a package.
 *
 * The public registry is queried without auth. Private registries require an
 * auth token; when `getAuthToken` is null (no credentials configured) the
 * search reports "not found" rather than failing.
 *
 * @param args - The search parameters
 * @param args.registryUrl - The registry URL to search
 * @param args.fetchPackument - Fetches the packument from a registry
 * @param args.getAuthToken - Resolves an auth token for private registries, or null when no auth is configured
 *
 * @returns Object with result (if found) and/or error (if failed)
 */
export const searchSpecificRegistry = async (args: {
  registryUrl: string;
  fetchPackument: (fetchArgs: {
    registryUrl: string;
    authToken?: string | null;
  }) => Promise<Packument>;
  getAuthToken: (() => Promise<string>) | null;
}): Promise<{
  result: RegistrySearchResult | null;
  error: RegistrySearchError | null;
}> => {
  const { registryUrl, fetchPackument, getAuthToken } = args;

  // Check if this is the public registry
  if (registryUrl === REGISTRAR_URL) {
    try {
      const packument = await fetchPackument({ registryUrl: REGISTRAR_URL });
      return {
        result: { registryUrl: REGISTRAR_URL, packument },
        error: null,
      };
    } catch (err) {
      if (err instanceof NetworkError) {
        return {
          result: null,
          error: {
            registryUrl: REGISTRAR_URL,
            isNetworkError: true,
            message: err.message,
          },
        };
      }
      // API error (like 404) - package not found
      return { result: null, error: null };
    }
  }

  // Private registry - require auth
  if (getAuthToken == null) {
    return { result: null, error: null };
  }

  try {
    const authToken = await getAuthToken();
    const packument = await fetchPackument({ registryUrl, authToken });
    return {
      result: { registryUrl, packument, authToken },
      error: null,
    };
  } catch (err) {
    if (err instanceof NetworkError) {
      return {
        result: null,
        error: {
          registryUrl,
          isNetworkError: true,
          message: err.message,
        },
      };
    }
    // API error (like 404) - package not found
    return { result: null, error: null };
  }
};

/**
 * Format the list of available versions for a package
 * @param args - The format parameters
 * @param args.packageName - The package name
 * @param args.packument - The packument containing version information
 * @param args.registryUrl - The registry URL
 * @param args.downloadCommand - The full download command hint (e.g. "nori-skillsets download")
 *
 * @returns Formatted version list message
 */
export const formatVersionList = (args: {
  packageName: string;
  packument: Packument;
  registryUrl: string;
  downloadCommand: string;
}): string => {
  const { packageName, packument, registryUrl, downloadCommand } = args;
  const distTags = packument["dist-tags"];
  const versions = Object.keys(packument.versions);
  const timeInfo = packument.time ?? {};

  // Sort versions in descending order (newest first)
  const sortedVersions = versions.sort((a, b) => {
    const timeA = timeInfo[a] ? new Date(timeInfo[a]).getTime() : 0;
    const timeB = timeInfo[b] ? new Date(timeInfo[b]).getTime() : 0;
    return timeB - timeA;
  });

  const lines = [
    `Available versions of "${packageName}" from ${registryUrl}:\n`,
    "Dist-tags:",
  ];

  // Show dist-tags first
  for (const [tag, version] of Object.entries(distTags)) {
    lines.push(`  ${tag}: ${version}`);
  }

  lines.push("\nVersions:");

  // Show all versions with timestamps
  for (const version of sortedVersions) {
    const timestamp = timeInfo[version]
      ? new Date(timeInfo[version]).toLocaleDateString()
      : "";
    const tags = Object.entries(distTags)
      .filter(([, v]) => v === version)
      .map(([t]) => t);
    const tagStr = tags.length > 0 ? ` (${tags.join(", ")})` : "";
    const timeStr = timestamp ? ` - ${timestamp}` : "";
    lines.push(`  ${version}${tagStr}${timeStr}`);
  }

  lines.push(
    `\nTo download a specific version:\n  ${downloadCommand} ${packageName}@<version>`,
  );

  return lines.join("\n");
};

/**
 * Format the error message shown when a package name matches in multiple registries
 * @param args - The format parameters
 * @param args.packageName - The package name that was searched
 * @param args.results - The search results from multiple registries
 * @param args.entityLabel - The plural entity label (e.g. "packages", "skills", "subagents")
 * @param args.downloadCommand - The full download command hint (e.g. "nori-skillsets download")
 *
 * @returns Formatted error message
 */
export const formatMultipleMatchesError = (args: {
  packageName: string;
  results: Array<RegistrySearchResult>;
  entityLabel: string;
  downloadCommand: string;
}): string => {
  const { packageName, results, entityLabel, downloadCommand } = args;

  const lines = [`Multiple ${entityLabel} with the same name found.\n`];

  for (const result of results) {
    const version = result.packument["dist-tags"].latest ?? "unknown";
    const description = result.packument.description ?? "";
    lines.push(result.registryUrl);
    lines.push(`  -> ${packageName}@${version}: ${description}\n`);
  }

  lines.push("To download, please specify the registry with --registry:");
  for (const result of results) {
    lines.push(
      `${downloadCommand} ${packageName} --registry ${result.registryUrl}`,
    );
  }

  return lines.join("\n");
};
