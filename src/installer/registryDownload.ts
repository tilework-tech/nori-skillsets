/**
 * CLI command for downloading profile packages from the Nori registrar
 * Handles: nori-ai registry-download <package>[@version]
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import * as tar from "tar";

import { registrarApi } from "@/api/registrar.js";
import { error, success, info } from "@/installer/logger.js";
import { getInstallDirs } from "@/utils/path.js";

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
 * Download and install a profile from the registrar
 * @param args - The download parameters
 * @param args.packageSpec - Package name with optional version (e.g., "my-profile" or "my-profile@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 */
export const registryDownloadMain = async (args: {
  packageSpec: string;
  cwd?: string | null;
  installDir?: string | null;
}): Promise<void> => {
  const { packageSpec, installDir } = args;
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

  // Download and extract the tarball
  try {
    info({ message: `Downloading profile "${packageName}"...` });

    const tarballData = await registrarApi.downloadTarball({
      packageName,
      version: version ?? undefined,
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
    .action(async (packageSpec: string) => {
      const globalOpts = program.opts();

      await registryDownloadMain({
        packageSpec,
        installDir: globalOpts.installDir || null,
      });
    });
};
