/**
 * CLI command for updating installed profile packages from the Nori registrar
 * Handles: nori-ai registry-update <profile> [--registry <url>]
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
import {
  checkRegistryAgentSupport,
  showCursorAgentNotSupportedError,
} from "@/cli/commands/registryAgentCheck.js";
import { getRegistryAuth } from "@/cli/config.js";
import { error, success, info, newline } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import type { Command } from "commander";

/**
 * Version info stored in .nori-version file
 */
type VersionInfo = {
  version: string;
  registryUrl: string;
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
 * Update an installed profile to the latest version from the registrar
 * @param args - The update parameters
 * @param args.profileName - Profile name to update
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL override (uses stored registry URL if not provided)
 */
export const registryUpdateMain = async (args: {
  profileName: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
}): Promise<void> => {
  const { profileName, installDir, registryUrl: overrideRegistryUrl } = args;
  const cwd = args.cwd ?? process.cwd();

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

  // Check if cursor-agent-only installation (not supported for registry commands)
  const agentCheck = await checkRegistryAgentSupport({
    installDir: targetInstallDir,
  });
  if (!agentCheck.supported) {
    showCursorAgentNotSupportedError();
    return;
  }

  // Use config from agentCheck (already loaded during support check)
  const config = agentCheck.config;

  const profilesDir = path.join(targetInstallDir, ".claude", "profiles");
  const profileDir = path.join(profilesDir, profileName);

  // Check if profile is installed
  try {
    await fs.access(profileDir);
  } catch {
    error({
      message: `Profile "${profileName}" is not installed.\n\nUse 'nori-ai registry-download ${profileName}' to install it first.`,
    });
    return;
  }

  // Read version info
  const versionInfo = await readVersionInfo({ profileDir });
  if (versionInfo == null) {
    error({
      message: `Profile "${profileName}" has no version information (.nori-version file).\n\nThis profile may have been installed manually or with an older version of Nori.\n\nTo update, remove the profile and reinstall with:\n  rm -rf "${profileDir}"\n  nori-ai registry-download ${profileName}`,
    });
    return;
  }

  const { version: installedVersion, registryUrl: storedRegistryUrl } =
    versionInfo;
  const targetRegistryUrl = overrideRegistryUrl ?? storedRegistryUrl;

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
    error({
      message: `Failed to check for updates for "${profileName}":\n${errorMessage}`,
    });
    return;
  }

  // Compare versions using semver
  if (
    semver.valid(installedVersion) != null &&
    semver.valid(latestVersion) != null
  ) {
    if (!semver.gt(latestVersion, installedVersion)) {
      success({
        message: `Profile "${profileName}" is already at latest version (${installedVersion}).`,
      });
      return;
    }
  } else if (installedVersion === latestVersion) {
    // Fallback for non-semver versions
    success({
      message: `Profile "${profileName}" is already at latest version (${installedVersion}).`,
    });
    return;
  }

  // Download and extract the new version
  try {
    info({
      message: `Updating profile "${profileName}" from ${installedVersion} to ${latestVersion}...`,
    });

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

    newline();
    success({
      message: `Updated "${profileName}" from ${installedVersion} to ${latestVersion} from ${targetRegistryUrl}.`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to update profile "${profileName}":\n${errorMessage}`,
    });
  }
};

/**
 * Register the 'registry-update' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistryUpdateCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("registry-update <profile>")
    .description("Update an installed profile package to the latest version")
    .option(
      "--registry <url>",
      "Use a different registry URL instead of the stored one",
    )
    .action(async (profileName: string, options: { registry?: string }) => {
      const globalOpts = program.opts();

      await registryUpdateMain({
        profileName,
        installDir: globalOpts.installDir || null,
        registryUrl: options.registry || null,
      });
    });
};
