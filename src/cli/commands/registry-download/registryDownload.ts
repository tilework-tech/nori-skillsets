/**
 * CLI command for downloading profile packages from the Nori registrar
 * Handles: nori-ai registry-download <package>[@version] [--registry <url>]
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
import { error, success, info } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import type { Packument } from "@/api/registrar.js";
import type { Config } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Parse package name and optional version from package spec
 * Supports formats: "package-name" or "package-name@1.0.0"
 * @param args - The parsing parameters
 * @param args.packageSpec - Package specification string
 *
 * @returns Parsed package name and optional version
 */
const parsePackageSpec = (args: {
  packageSpec: string;
}): { packageName: string; version?: string | null } => {
  const { packageSpec } = args;
  const match = packageSpec.match(/^([a-z0-9-]+)(?:@(\d+\.\d+\.\d+.*))?$/i);

  if (!match) {
    return { packageName: packageSpec, version: null };
  }

  return {
    packageName: match[1],
    version: match[2] ?? null,
  };
};

/**
 * Check if buffer starts with gzip magic bytes (0x1f 0x8b)
 * @param args - The check parameters
 * @param args.buffer - The buffer to check
 *
 * @returns True if the buffer is gzip compressed
 */
const isGzipped = (args: { buffer: Buffer }): boolean => {
  const { buffer } = args;
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

  const buffer = Buffer.from(tarballData);
  const readable = Readable.from(buffer);

  if (isGzipped({ buffer })) {
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
 * Result of searching for a package in a registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  packument: Packument;
  authToken?: string | null;
};

/**
 * Search all registries for a package
 * Public registry is searched without auth, private registries require auth
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

  // Search private registries from config (auth required)
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
 * @returns The search result or null if not found or no auth configured
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

  // Private registry - require auth from config
  if (config == null) {
    return null;
  }

  const registryAuth = getRegistryAuth({ config, registryUrl });
  if (registryAuth == null) {
    return null;
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

  lines.push("To download, please specify the registry with --registry:");
  for (const result of results) {
    lines.push(
      `nori-ai registry-download ${packageName} --registry ${result.registryUrl}`,
    );
  }

  return lines.join("\n");
};

/**
 * Download and install a profile from the registrar
 * @param args - The download parameters
 * @param args.packageSpec - Package name with optional version (e.g., "my-profile" or "my-profile@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL to download from
 */
export const registryDownloadMain = async (args: {
  packageSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
}): Promise<void> => {
  const { packageSpec, installDir, registryUrl } = args;
  const cwd = args.cwd ?? process.cwd();

  const { packageName, version } = parsePackageSpec({ packageSpec });

  // Find installation directory
  let targetInstallDir: string;

  if (installDir != null) {
    targetInstallDir = installDir;
  } else {
    const allInstallations = getInstallDirs({ currentDir: cwd });

    if (allInstallations.length === 0) {
      error({
        message: "No Nori installation found.",
      });
      info({
        message: "Run 'npx nori-ai install' to install Nori Profiles.",
      });
      return;
    }

    if (allInstallations.length > 1) {
      const installList = allInstallations
        .map((dir, index) => `${index + 1}. ${dir}`)
        .join("\n");

      error({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease use --install-dir to specify the target installation.`,
      });
      return;
    }

    targetInstallDir = allInstallations[0];
  }

  const profilesDir = path.join(targetInstallDir, ".claude", "profiles");
  const targetDir = path.join(profilesDir, packageName);

  // Check if profile already exists
  try {
    await fs.access(targetDir);
    error({
      message: `Profile "${packageName}" already exists at:\n${targetDir}\n\nTo reinstall, first remove the existing profile directory.`,
    });
    return;
  } catch {
    // Directory doesn't exist - continue
  }

  // Load config to get registry authentication
  const config = await loadConfig({ installDir: targetInstallDir });

  // Search for the package
  let searchResults: Array<RegistrySearchResult>;

  if (registryUrl != null) {
    // User specified a specific registry
    // Check if private registry requires auth
    if (registryUrl !== REGISTRAR_URL) {
      const registryAuth =
        config != null ? getRegistryAuth({ config, registryUrl }) : null;
      if (registryAuth == null) {
        error({
          message: `No authentication configured for registry: ${registryUrl}\n\nAdd registry credentials to your .nori-config.json file.`,
        });
        return;
      }
    }

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
    error({
      message: `Profile "${packageName}" not found in any registry.`,
    });
    return;
  }

  if (searchResults.length > 1) {
    error({
      message: formatMultiplePackagesError({
        packageName,
        results: searchResults,
      }),
    });
    return;
  }

  // Single result - download from that registry
  const selectedRegistry = searchResults[0];

  // Download and extract the tarball
  try {
    info({ message: `Downloading profile "${packageName}"...` });

    const tarballData = await registrarApi.downloadTarball({
      packageName,
      version: version ?? undefined,
      registryUrl: selectedRegistry.registryUrl,
      authToken: selectedRegistry.authToken ?? undefined,
    });

    // Create target directory
    await fs.mkdir(targetDir, { recursive: true });

    try {
      await extractTarball({ tarballData, targetDir });
    } catch (extractErr) {
      // Clean up on extraction failure
      await fs.rm(targetDir, { recursive: true, force: true });
      throw extractErr;
    }

    const versionStr = version ? `@${version}` : " (latest)";
    console.log("");
    success({
      message: `Downloaded and installed profile "${packageName}"${versionStr}`,
    });
    info({ message: `Installed to: ${targetDir}` });
    console.log("");
    info({
      message: `You can now use this profile with 'nori-ai switch-profile ${packageName}'.`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to download profile "${packageName}": ${errorMessage}`,
    });
  }
};

/**
 * Register the 'registry-download' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistryDownloadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("registry-download <package>")
    .description(
      "Download and install a profile package from the Nori registrar",
    )
    .option(
      "--registry <url>",
      "Download from a specific registry URL instead of searching all registries",
    )
    .action(async (packageSpec: string, options: { registry?: string }) => {
      const globalOpts = program.opts();

      await registryDownloadMain({
        packageSpec,
        installDir: globalOpts.installDir || null,
        registryUrl: options.registry || null,
      });
    });
};
