/**
 * Intercepted slash command for uploading profiles to the registry
 * Handles /nori-registry-upload <profile-name> [version] [registry-url] command
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as semver from "semver";
import * as tar from "tar";

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";
import type { Config, RegistryAuth } from "@/cli/config.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Parse profile name, optional version, and optional registry URL from prompt
 * Supports formats:
 *   - "profile-name"
 *   - "profile-name version"
 *   - "profile-name registry-url"
 *   - "profile-name version registry-url"
 * @param prompt - The user prompt to parse
 *
 * @returns Parsed upload args or null if invalid
 */
const parseUploadArgs = (
  prompt: string,
): {
  profileName: string;
  version?: string | null;
  registryUrl?: string | null;
} | null => {
  const match = prompt
    .trim()
    .match(
      /^\/nori-registry-upload\s+([a-z0-9-]+)(?:\s+(\d+\.\d+\.\d+[^\s]*))?(?:\s+(https?:\/\/\S+))?$/i,
    );

  if (!match) {
    return null;
  }

  return {
    profileName: match[1],
    version: match[2] ?? null,
    registryUrl: match[3] ?? null,
  };
};

/**
 * Get list of registries the user can upload to
 * @param args - The function arguments
 * @param args.config - The Nori configuration
 *
 * @returns Array of registry URLs with auth configured
 */
const getAvailableUploadRegistries = (args: {
  config: Config;
}): Array<RegistryAuth> => {
  const { config } = args;

  if (config.registryAuths == null || config.registryAuths.length === 0) {
    return [];
  }

  return config.registryAuths;
};

/**
 * Format error message when multiple registries are available
 * @param args - The function arguments
 * @param args.profileName - The profile name to upload
 * @param args.registries - The available registries
 *
 * @returns Formatted error message
 */
const formatMultipleRegistriesError = (args: {
  profileName: string;
  registries: Array<RegistryAuth>;
}): string => {
  const { profileName, registries } = args;

  const lines = [
    "Multiple registries configured. Please specify which registry to upload to.\n",
    "Available registries:",
  ];

  for (const registry of registries) {
    lines.push(`  -> ${registry.registryUrl}`);
  }

  lines.push("\nTo upload, include the registry URL:");
  for (const registry of registries) {
    lines.push(`/nori-registry-upload ${profileName} ${registry.registryUrl}`);
  }

  return lines.join("\n");
};

/**
 * Determine the version to upload
 * If no version is specified, auto-bump from the latest version in the registry
 * If the package doesn't exist, default to 1.0.0
 * @param args - The function arguments
 * @param args.profileName - The profile name to upload
 * @param args.explicitVersion - The explicit version if provided by user
 * @param args.registryUrl - The registry URL to check
 * @param args.authToken - The auth token for the registry
 *
 * @returns The version to upload
 */
const determineUploadVersion = async (args: {
  profileName: string;
  explicitVersion?: string | null;
  registryUrl: string;
  authToken?: string | null;
}): Promise<string> => {
  const { profileName, explicitVersion, registryUrl, authToken } = args;

  // If user provided explicit version, use it
  if (explicitVersion != null) {
    return explicitVersion;
  }

  // Try to get the current latest version from the registry
  try {
    const packument = await registrarApi.getPackument({
      packageName: profileName,
      registryUrl,
      authToken,
    });

    const latestVersion = packument["dist-tags"].latest;
    if (latestVersion != null && semver.valid(latestVersion) != null) {
      // Auto-bump patch version
      const nextVersion = semver.inc(latestVersion, "patch");
      if (nextVersion != null) {
        return nextVersion;
      }
    }
  } catch {
    // Package doesn't exist or error fetching - default to 1.0.0
  }

  return "1.0.0";
};

/**
 * Create a gzipped tarball from a profile directory
 * @param args - The tarball parameters
 * @param args.profileDir - The directory to create tarball from
 *
 * @returns The tarball data as Buffer
 */
const createProfileTarball = async (args: {
  profileDir: string;
}): Promise<Buffer> => {
  const { profileDir } = args;

  // Get list of files in profile directory
  const files = await fs.readdir(profileDir, { recursive: true });
  const filesToPack: Array<string> = [];

  for (const file of files) {
    const filePath = path.join(profileDir, file);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      filesToPack.push(file);
    }
  }

  // Use tar.create with file option then read it
  const tempTarPath = path.join(
    profileDir,
    "..",
    `.${path.basename(profileDir)}-upload.tgz`,
  );

  try {
    await tar.create(
      {
        gzip: true,
        file: tempTarPath,
        cwd: profileDir,
      },
      filesToPack,
    );

    const tarballBuffer = await fs.readFile(tempTarPath);
    return tarballBuffer;
  } finally {
    // Clean up temp file
    await fs.unlink(tempTarPath).catch(() => {
      /* ignore */
    });
  }
};

/**
 * Run the nori-registry-upload command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with upload result, or null if not handled
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Parse upload args from prompt
  const uploadArgs = parseUploadArgs(prompt);
  if (uploadArgs == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Upload a profile to the Nori registry.\n\nUsage: /nori-registry-upload <profile-name> [version] [registry-url]\n\nExamples:\n  /nori-registry-upload my-profile\n  /nori-registry-upload my-profile 1.0.0\n  /nori-registry-upload my-profile https://registry.example.com\n  /nori-registry-upload my-profile 1.0.0 https://registry.example.com\n\nRequires registry authentication in .nori-config.json`,
      }),
    };
  }

  const { profileName, version, registryUrl } = uploadArgs;

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

  // Load config
  const config = await loadConfig({ installDir });
  if (config == null) {
    return {
      decision: "block",
      reason: formatError({
        message: `Could not load Nori configuration.`,
      }),
    };
  }

  // Get available registries
  const availableRegistries = getAvailableUploadRegistries({ config });

  if (availableRegistries.length === 0) {
    return {
      decision: "block",
      reason: formatError({
        message: `No registry authentication configured.\n\nAdd registry credentials to .nori-config.json:\n{\n  "registryAuths": [{\n    "username": "your-email@example.com",\n    "password": "your-password",\n    "registryUrl": "https://registry.example.com"\n  }]\n}`,
      }),
    };
  }

  // Determine target registry
  let targetRegistryUrl: string;
  let registryAuth: RegistryAuth | null;

  if (registryUrl != null) {
    // User specified a registry URL - validate it exists in config
    registryAuth = getRegistryAuth({ config, registryUrl });
    if (registryAuth == null) {
      return {
        decision: "block",
        reason: formatError({
          message: `No registry authentication configured for ${registryUrl}.\n\nAdd credentials to .nori-config.json or use one of the configured registries.`,
        }),
      };
    }
    targetRegistryUrl = registryUrl;
  } else if (availableRegistries.length === 1) {
    // Single registry - use it
    registryAuth = availableRegistries[0];
    targetRegistryUrl = registryAuth.registryUrl;
  } else {
    // Multiple registries - require explicit selection
    return {
      decision: "block",
      reason: formatError({
        message: formatMultipleRegistriesError({
          profileName,
          registries: availableRegistries,
        }),
      }),
    };
  }

  // Check profile exists
  const profileDir = path.join(installDir, ".claude", "profiles", profileName);
  try {
    await fs.access(profileDir);
  } catch {
    return {
      decision: "block",
      reason: formatError({
        message: `Profile "${profileName}" not found at:\n${profileDir}`,
      }),
    };
  }

  // Get auth token
  let authToken: string;
  try {
    authToken = await getRegistryAuthToken({ registryAuth });
  } catch (err) {
    return {
      decision: "block",
      reason: formatError({
        message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }

  // Determine version to upload (auto-bump if not specified)
  const uploadVersion = await determineUploadVersion({
    profileName,
    explicitVersion: version,
    registryUrl: targetRegistryUrl,
    authToken,
  });

  // Create tarball and upload
  try {
    const tarballBuffer = await createProfileTarball({ profileDir });
    // Convert Buffer to ArrayBuffer
    const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(archiveData).set(tarballBuffer);
    const result = await registrarApi.uploadProfile({
      packageName: profileName,
      version: uploadVersion,
      archiveData,
      authToken,
      registryUrl: targetRegistryUrl,
    });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Successfully uploaded "${profileName}@${result.version}" to ${targetRegistryUrl}.\n\nOthers can install it with:\n/nori-registry-download ${profileName}`,
      }),
    };
  } catch (err) {
    return {
      decision: "block",
      reason: formatError({
        message: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }
};

/**
 * nori-registry-upload intercepted slash command
 */
export const noriRegistryUpload: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-registry-upload\\s*$", // Bare command - shows help
    "^\\/nori-registry-upload\\s+[a-z0-9-]+(?:\\s+\\d+\\.\\d+\\.\\d+[^\\s]*)?(?:\\s+https?:\\/\\/\\S+)?\\s*$", // With args (profile, optional version, optional registry)
    "^\\/nori-registry-upload\\s+[a-z0-9-]+\\s+https?:\\/\\/\\S+\\s*$", // With profile and registry URL (no version)
  ],
  run,
};
