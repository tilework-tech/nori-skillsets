/**
 * Intercepted slash command for downloading profile packages
 * Handles /nori-registry-download <package-name>[@version] [registry-url] command
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import * as tar from "tar";

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";
import type { Packument } from "@/api/registrar.js";
import type { Config } from "@/cli/config.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Parsed package spec from command
 */
type ParsedPackageSpec = {
  packageName: string;
  version?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
};

/**
 * Parse package name, optional version, and optional registry URL from prompt
 * Supports formats:
 *   - "package-name"
 *   - "package-name@1.0.0"
 *   - "package-name https://registry.url"
 *   - "package-name@1.0.0 https://registry.url"
 *   - "--list-versions package-name"
 *   - "--list-versions package-name https://registry.url"
 * @param prompt - The user prompt to parse
 *
 * @returns Parsed package spec or null if invalid
 */
const parsePackageSpec = (prompt: string): ParsedPackageSpec | null => {
  // Check for --list-versions flag first
  const listVersionsMatch = prompt
    .trim()
    .match(
      /^\/nori-registry-download\s+--list-versions\s+([a-z0-9-]+)(?:\s+(https?:\/\/\S+))?$/i,
    );

  if (listVersionsMatch) {
    return {
      packageName: listVersionsMatch[1],
      listVersions: true,
      registryUrl: listVersionsMatch[2] ?? null,
    };
  }

  // Standard download format
  const match = prompt
    .trim()
    .match(
      /^\/nori-registry-download\s+([a-z0-9-]+)(?:@(\d+\.\d+\.\d+.*))?(?:\s+(https?:\/\/\S+))?$/i,
    );

  if (!match) {
    return null;
  }

  return {
    packageName: match[1],
    version: match[2] ?? null,
    registryUrl: match[3] ?? null,
    listVersions: false,
  };
};

/**
 * Result of searching for a package in a registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  packument: Packument;
  authToken?: string | null;
};

/**
 * Search all registries for a package
 * Public registry is searched first, then private registries from config
 * @param args - The search parameters
 * @param args.packageName - The package name to search for
 * @param args.config - The Nori configuration containing registry auth
 *
 * @returns Array of registries where the package was found
 */
const searchAllRegistries = async (args: {
  packageName: string;
  config: Config | null;
}): Promise<Array<RegistrySearchResult>> => {
  const { packageName, config } = args;
  const results: Array<RegistrySearchResult> = [];

  // Search public registry first (no auth needed)
  try {
    const packument = await registrarApi.getPackument({
      packageName,
      registryUrl: REGISTRAR_URL,
    });
    results.push({
      registryUrl: REGISTRAR_URL,
      packument,
    });
  } catch {
    // Package not found in public registry - continue to private registries
  }

  // Search private registries from config
  if (config?.registryAuths != null) {
    for (const registryAuth of config.registryAuths) {
      try {
        // Get auth token for this registry
        const authToken = await getRegistryAuthToken({ registryAuth });

        const packument = await registrarApi.getPackument({
          packageName,
          registryUrl: registryAuth.registryUrl,
          authToken,
        });

        results.push({
          registryUrl: registryAuth.registryUrl,
          packument,
          authToken,
        });
      } catch {
        // Package not found or auth failed for this registry - continue
      }
    }
  }

  return results;
};

/**
 * Search a specific registry for a package
 * @param args - The search parameters
 * @param args.packageName - The package name to search for
 * @param args.registryUrl - The registry URL to search
 * @param args.config - The Nori configuration containing registry auth
 *
 * @returns The search result or null if not found
 */
const searchSpecificRegistry = async (args: {
  packageName: string;
  registryUrl: string;
  config: Config | null;
}): Promise<RegistrySearchResult | null> => {
  const { packageName, registryUrl, config } = args;

  // Check if this is the public registry
  if (registryUrl === REGISTRAR_URL) {
    try {
      const packument = await registrarApi.getPackument({
        packageName,
        registryUrl: REGISTRAR_URL,
      });
      return {
        registryUrl: REGISTRAR_URL,
        packument,
      };
    } catch {
      return null;
    }
  }

  // Private registry - need auth
  // Handle null config by trying without auth
  if (config == null) {
    try {
      const packument = await registrarApi.getPackument({
        packageName,
        registryUrl,
      });
      return {
        registryUrl,
        packument,
      };
    } catch {
      return null;
    }
  }

  const registryAuth = getRegistryAuth({ config, registryUrl });
  if (registryAuth == null) {
    // Try without auth anyway (registry might allow public reads)
    try {
      const packument = await registrarApi.getPackument({
        packageName,
        registryUrl,
      });
      return {
        registryUrl,
        packument,
      };
    } catch {
      return null;
    }
  }

  try {
    const authToken = await getRegistryAuthToken({ registryAuth });
    const packument = await registrarApi.getPackument({
      packageName,
      registryUrl,
      authToken,
    });
    return {
      registryUrl,
      packument,
      authToken,
    };
  } catch {
    return null;
  }
};

/**
 * Check if buffer starts with gzip magic bytes (0x1f 0x8b)
 * @param buffer - The buffer to check
 *
 * @returns True if the buffer is gzip compressed
 */
const isGzipped = (buffer: Buffer): boolean => {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
};

/**
 * Extract a tarball to a directory
 * @param args - The extraction parameters
 * @param args.tarballData - The tarball data as ArrayBuffer
 * @param args.targetDir - The directory to extract to
 */
const extractTarball = async (args: {
  tarballData: ArrayBuffer;
  targetDir: string;
}): Promise<void> => {
  const { tarballData, targetDir } = args;

  // Convert ArrayBuffer to Buffer
  const buffer = Buffer.from(tarballData);

  // Create a readable stream from the buffer
  const readable = Readable.from(buffer);

  // Extract using tar, with optional gzip decompression based on magic bytes
  if (isGzipped(buffer)) {
    await pipeline(
      readable,
      zlib.createGunzip(),
      tar.extract({ cwd: targetDir }),
    );
  } else {
    await pipeline(readable, tar.extract({ cwd: targetDir }));
  }
};

/**
 * Format the list of available versions for a package
 * @param args - The format parameters
 * @param args.packageName - The package name
 * @param args.packument - The packument containing version information
 * @param args.registryUrl - The registry URL
 *
 * @returns Formatted version list message
 */
const formatVersionList = (args: {
  packageName: string;
  packument: Packument;
  registryUrl: string;
}): string => {
  const { packageName, packument, registryUrl } = args;
  const distTags = packument["dist-tags"];
  const versions = Object.keys(packument.versions);
  const timeInfo = packument.time ?? {};

  // Sort versions in descending order (newest first)
  const sortedVersions = versions.sort((a, b) => {
    // Try to sort by semver, fall back to string comparison
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
    `\nTo download a specific version:\n  /nori-registry-download ${packageName}@<version>`,
  );

  return lines.join("\n");
};

/**
 * Format the multiple packages found error message
 * @param args - The format parameters
 * @param args.packageName - The package name that was searched
 * @param args.results - The search results from multiple registries
 *
 * @returns Formatted error message
 */
const formatMultiplePackagesError = (args: {
  packageName: string;
  results: Array<RegistrySearchResult>;
}): string => {
  const { packageName, results } = args;

  const lines = ["Multiple packages with the same name found.\n"];

  for (const result of results) {
    const version = result.packument["dist-tags"].latest ?? "unknown";
    const description = result.packument.description ?? "";
    lines.push(result.registryUrl);
    lines.push(`  -> ${packageName}@${version}: ${description}\n`);
  }

  lines.push("To download, please include the registry URL:");
  for (const result of results) {
    lines.push(`/nori-registry-download ${packageName} ${result.registryUrl}`);
  }

  return lines.join("\n");
};

/**
 * Run the nori-registry-download command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with download result, or null if not handled
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Parse package spec from prompt
  const packageSpec = parsePackageSpec(prompt);
  if (packageSpec == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Download and install a profile package from the Nori registry.\n\nUsage: /nori-registry-download <package-name>[@version] [registry-url]\n\nExamples:\n  /nori-registry-download my-profile\n  /nori-registry-download my-profile@1.0.0\n  /nori-registry-download my-profile https://private-registry.com\n\nUse /nori-registry-search to find available packages.`,
      }),
    };
  }

  const { packageName, version, registryUrl, listVersions } = packageSpec;

  // Find installation directory
  const allInstallations = getInstallDirs({ currentDir: cwd });

  if (allInstallations.length === 0) {
    return {
      decision: "block",
      reason: formatError({
        message: `No Nori installation found.\n\nRun 'npx nori-ai install' to install Nori Profiles.`,
      }),
    };
  }

  if (allInstallations.length > 1) {
    const installList = allInstallations
      .map((dir, index) => `${index + 1}. ${dir}`)
      .join("\n");

    return {
      decision: "block",
      reason: formatError({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease navigate to the specific installation directory and try again.`,
      }),
    };
  }

  const installDir = allInstallations[0];
  const profilesDir = path.join(installDir, ".claude", "profiles");
  const targetDir = path.join(profilesDir, packageName);

  // Check if profile already exists (skip for --list-versions)
  if (!listVersions) {
    try {
      await fs.access(targetDir);
      // Directory exists - warn user
      return {
        decision: "block",
        reason: formatError({
          message: `Profile "${packageName}" already exists at:\n${targetDir}\n\nTo reinstall, first remove the existing profile directory.`,
        }),
      };
    } catch {
      // Directory doesn't exist - continue
    }
  }

  // Load config to get registry authentication
  const config = await loadConfig({ installDir });

  // Search for the package
  let searchResults: Array<RegistrySearchResult>;

  if (registryUrl != null) {
    // User specified a specific registry
    const result = await searchSpecificRegistry({
      packageName,
      registryUrl,
      config,
    });
    searchResults = result != null ? [result] : [];
  } else {
    // Search all registries
    searchResults = await searchAllRegistries({ packageName, config });
  }

  // Handle search results
  if (searchResults.length === 0) {
    return {
      decision: "block",
      reason: formatError({
        message: `Profile "${packageName}" not found in any registry.`,
      }),
    };
  }

  if (searchResults.length > 1) {
    return {
      decision: "block",
      reason: formatError({
        message: formatMultiplePackagesError({
          packageName,
          results: searchResults,
        }),
      }),
    };
  }

  // Single result - download from that registry
  const selectedRegistry = searchResults[0];

  // If --list-versions flag is set, show versions and exit
  if (listVersions) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: formatVersionList({
          packageName,
          packument: selectedRegistry.packument,
          registryUrl: selectedRegistry.registryUrl,
        }),
      }),
    };
  }

  // Download and extract the tarball
  try {
    const tarballData = await registrarApi.downloadTarball({
      packageName,
      version: version ?? undefined,
      registryUrl: selectedRegistry.registryUrl,
      authToken: selectedRegistry.authToken,
    });

    // Create target directory only after successful download
    await fs.mkdir(targetDir, { recursive: true });

    try {
      await extractTarball({ tarballData, targetDir });
    } catch (extractErr) {
      // Clean up empty directory on extraction failure
      await fs.rm(targetDir, { recursive: true, force: true });
      throw extractErr;
    }

    // Write .nori-version file for update tracking
    const installedVersion =
      version ?? selectedRegistry.packument["dist-tags"].latest;
    await fs.writeFile(
      path.join(targetDir, ".nori-version"),
      JSON.stringify(
        {
          version: installedVersion,
          registryUrl: selectedRegistry.registryUrl,
        },
        null,
        2,
      ),
    );

    const versionStr = version ? `@${version}` : " (latest)";
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Downloaded and installed profile "${packageName}"${versionStr} from ${selectedRegistry.registryUrl}\n\nInstalled to: ${targetDir}\n\nYou can now use this profile with '/nori-switch-profile ${packageName}'.`,
      }),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to download profile "${packageName}":\n${errorMessage}`,
      }),
    };
  }
};

/**
 * nori-registry-download intercepted slash command
 */
export const noriRegistryDownload: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-registry-download\\s*$", // Bare command (no package) - shows help
    "^\\/nori-registry-download\\s+--list-versions\\s+[a-z0-9-]+(?:\\s+https?://\\S+)?\\s*$", // --list-versions flag
    "^\\/nori-registry-download\\s+[a-z0-9-]+(?:@\\d+\\.\\d+\\.\\d+.*)?(?:\\s+https?://\\S+)?\\s*$", // Command with package and optional registry URL
  ],
  run,
};
