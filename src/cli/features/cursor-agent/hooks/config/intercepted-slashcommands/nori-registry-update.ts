/**
 * Intercepted slash command for updating installed profile packages
 * Handles /nori-registry-update <profile-name> [registry-url] command
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import * as semver from "semver";
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

import { formatError, formatSuccess } from "./format.js";

/**
 * Version info stored in .nori-version file
 */
type VersionInfo = {
  version: string;
  registryUrl: string;
};

/**
 * Parse profile name and optional registry URL from prompt
 * @param prompt - The user prompt to parse
 *
 * @returns Parsed profile spec or null if invalid
 */
const parseProfileSpec = (
  prompt: string,
): { profileName: string; registryUrl?: string | null } | null => {
  // Standard format: /nori-registry-update profile-name [registry-url]
  const match = prompt
    .trim()
    .match(/^\/nori-registry-update\s+([a-z0-9-]+)(?:\s+(https?:\/\/\S+))?$/i);

  if (!match) {
    return null;
  }

  return {
    profileName: match[1],
    registryUrl: match[2] ?? null,
  };
};

/**
 * Read the .nori-version file from a profile directory
 * @param args - The function arguments
 * @param args.profileDir - The profile directory path
 *
 * @returns The version info or null if not found
 */
const readVersionInfo = async (args: {
  profileDir: string;
}): Promise<VersionInfo | null> => {
  const { profileDir } = args;
  const versionFilePath = path.join(profileDir, ".nori-version");

  try {
    const content = await fs.readFile(versionFilePath, "utf-8");
    return JSON.parse(content) as VersionInfo;
  } catch {
    return null;
  }
};

/**
 * Write the .nori-version file to a profile directory
 * @param args - The function arguments
 * @param args.profileDir - The profile directory path
 * @param args.versionInfo - The version info to write
 */
const writeVersionInfo = async (args: {
  profileDir: string;
  versionInfo: VersionInfo;
}): Promise<void> => {
  const { profileDir, versionInfo } = args;
  const versionFilePath = path.join(profileDir, ".nori-version");
  await fs.writeFile(versionFilePath, JSON.stringify(versionInfo, null, 2));
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
 * Run the nori-registry-update command
 * @param args - The function arguments
 * @param args.input - The hook input containing prompt and cwd
 *
 * @returns The hook output with update result, or null if not handled
 */
const run = async (args: { input: HookInput }): Promise<HookOutput | null> => {
  const { input } = args;
  const { prompt, cwd } = input;

  // Parse profile spec from prompt
  const profileSpec = parseProfileSpec(prompt);
  if (profileSpec == null) {
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Update an installed profile package to the latest version.\n\nUsage: /nori-registry-update <profile-name> [registry-url]\n\nExamples:\n  /nori-registry-update my-profile\n  /nori-registry-update my-profile https://private-registry.com`,
      }),
    };
  }

  const { profileName, registryUrl: overrideRegistryUrl } = profileSpec;

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
  const profileDir = path.join(profilesDir, profileName);

  // Check if profile is installed
  try {
    await fs.access(profileDir);
  } catch {
    return {
      decision: "block",
      reason: formatError({
        message: `Profile "${profileName}" is not installed.\n\nUse /nori-registry-download ${profileName} to install it first.`,
      }),
    };
  }

  // Read version info
  const versionInfo = await readVersionInfo({ profileDir });
  if (versionInfo == null) {
    return {
      decision: "block",
      reason: formatError({
        message: `Profile "${profileName}" has no version information (.nori-version file).\n\nThis profile may have been installed manually or with an older version of Nori.\n\nTo update, remove the profile and reinstall with:\n  rm -rf "${profileDir}"\n  /nori-registry-download ${profileName}`,
      }),
    };
  }

  const { version: installedVersion, registryUrl: storedRegistryUrl } =
    versionInfo;
  const targetRegistryUrl = overrideRegistryUrl ?? storedRegistryUrl;

  // Load config to get registry authentication
  const config = await loadConfig({ installDir });

  // Get auth token if needed for private registry
  let authToken: string | undefined;
  if (targetRegistryUrl !== REGISTRAR_URL && config != null) {
    const registryAuth = getRegistryAuth({
      config,
      registryUrl: targetRegistryUrl,
    });
    if (registryAuth != null) {
      try {
        authToken = await getRegistryAuthToken({ registryAuth });
      } catch {
        // Continue without auth - registry might allow public reads
      }
    }
  }

  // Fetch packument to get latest version
  let latestVersion: string;
  try {
    const packument = await registrarApi.getPackument({
      packageName: profileName,
      registryUrl: targetRegistryUrl,
      authToken,
    });
    latestVersion = packument["dist-tags"].latest;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to check for updates for "${profileName}":\n${errorMessage}`,
      }),
    };
  }

  // Compare versions using semver
  if (
    semver.valid(installedVersion) != null &&
    semver.valid(latestVersion) != null
  ) {
    if (!semver.gt(latestVersion, installedVersion)) {
      return {
        decision: "block",
        reason: formatSuccess({
          message: `Profile "${profileName}" is already at latest version (${installedVersion}).`,
        }),
      };
    }
  } else if (installedVersion === latestVersion) {
    // Fallback for non-semver versions
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Profile "${profileName}" is already at latest version (${installedVersion}).`,
      }),
    };
  }

  // Download and extract the new version
  try {
    const tarballData = await registrarApi.downloadTarball({
      packageName: profileName,
      version: latestVersion,
      registryUrl: targetRegistryUrl,
      authToken,
    });

    // Extract to a temp directory first to ensure extraction succeeds before modifying profile
    const tempDir = path.join(profilesDir, `.${profileName}-update-temp`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      await extractTarball({ tarballData, targetDir: tempDir });
    } catch (extractErr) {
      // Clean up temp directory on extraction failure
      await fs.rm(tempDir, { recursive: true, force: true });
      throw extractErr;
    }

    // Extraction succeeded - now safely remove existing profile contents
    const existingFiles = await fs.readdir(profileDir);
    for (const file of existingFiles) {
      if (file !== ".nori-version") {
        await fs.rm(path.join(profileDir, file), {
          recursive: true,
          force: true,
        });
      }
    }

    // Move extracted files from temp to profile directory
    const extractedFiles = await fs.readdir(tempDir);
    for (const file of extractedFiles) {
      await fs.rename(path.join(tempDir, file), path.join(profileDir, file));
    }

    // Remove temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Update version file with new version and potentially new registry URL
    await writeVersionInfo({
      profileDir,
      versionInfo: {
        version: latestVersion,
        registryUrl: targetRegistryUrl,
      },
    });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Updated "${profileName}" from ${installedVersion} to ${latestVersion} from ${targetRegistryUrl}.`,
      }),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      decision: "block",
      reason: formatError({
        message: `Failed to update profile "${profileName}":\n${errorMessage}`,
      }),
    };
  }
};

/**
 * nori-registry-update intercepted slash command
 */
export const noriRegistryUpdate: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-registry-update\\s*$", // Bare command (no profile) - shows help
    "^\\/nori-registry-update\\s+[a-z0-9-]+(?:\\s+https?://\\S+)?\\s*$", // Command with profile and optional registry URL
  ],
  run,
};
