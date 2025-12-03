/**
 * Intercepted slash command for downloading profile packages
 * Handles /nori-download-profile <package-name>[@version] command
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import * as tar from "tar";

import { registrarApi } from "@/api/registrar.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Parse package name and optional version from prompt
 * Supports formats: "package-name" or "package-name@1.0.0"
 * @param prompt - The user prompt to parse
 *
 * @returns Parsed package spec or null if invalid
 */
const parsePackageSpec = (
  prompt: string,
): { packageName: string; version?: string | null } | null => {
  const match = prompt
    .trim()
    .match(/^\/nori-download-profile\s+([a-z0-9-]+)(?:@(\d+\.\d+\.\d+.*))?$/i);

  if (!match) {
    return null;
  }

  return {
    packageName: match[1],
    version: match[2] ?? null,
  };
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
 * Run the nori-download-profile command
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
        message: `Download and install a profile package from the Nori registrar.\n\nUsage: /nori-download-profile <package-name>[@version]\n\nExamples:\n  /nori-download-profile my-profile\n  /nori-download-profile my-profile@1.0.0\n\nUse /nori-search-profiles to find available packages.`,
      }),
    };
  }

  const { packageName, version } = packageSpec;

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

  // Check if profile already exists
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

  // Download and extract the tarball
  try {
    const tarballData = await registrarApi.downloadTarball({
      packageName,
      version: version ?? undefined,
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

    const versionStr = version ? `@${version}` : " (latest)";
    return {
      decision: "block",
      reason: formatSuccess({
        message: `Downloaded and installed profile "${packageName}"${versionStr}\n\nInstalled to: ${targetDir}\n\nYou can now use this profile with '/nori-switch-profile ${packageName}'.`,
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
 * nori-download-profile intercepted slash command
 */
export const noriDownloadProfile: InterceptedSlashCommand = {
  matchers: [
    "^\\/nori-download-profile\\s*$", // Bare command (no package) - shows help
    "^\\/nori-download-profile\\s+[a-z0-9-]+(?:@\\d+\\.\\d+\\.\\d+.*)?\\s*$", // Command with package
  ],
  run,
};
