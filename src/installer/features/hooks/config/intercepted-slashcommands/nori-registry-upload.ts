/**
 * Intercepted slash command for uploading profiles to the registry
 * Handles /nori-registry-upload <profile-name> [version] command
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as tar from "tar";

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/installer/config.js";
import { getInstallDirs } from "@/utils/path.js";

import type {
  HookInput,
  HookOutput,
  InterceptedSlashCommand,
} from "./types.js";

import { formatError, formatSuccess } from "./format.js";

/**
 * Parse profile name and optional version from prompt
 * Supports formats: "profile-name" or "profile-name version"
 * @param prompt - The user prompt to parse
 *
 * @returns Parsed upload args or null if invalid
 */
const parseUploadArgs = (
  prompt: string,
): { profileName: string; version?: string | null } | null => {
  const match = prompt
    .trim()
    .match(/^\/nori-registry-upload\s+([a-z0-9-]+)(?:\s+(\d+\.\d+\.\d+.*))?$/i);

  if (!match) {
    return null;
  }

  return {
    profileName: match[1],
    version: match[2] ?? null,
  };
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
        message: `Upload a profile to the Nori registry.\n\nUsage: /nori-registry-upload <profile-name> [version]\n\nExamples:\n  /nori-registry-upload my-profile\n  /nori-registry-upload my-profile 1.0.0\n\nRequires registry authentication in .nori-config.json`,
      }),
    };
  }

  const { profileName, version } = uploadArgs;
  const uploadVersion = version ?? "1.0.0"; // Default to 1.0.0

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

  // Check for registry auth
  const registryAuth = getRegistryAuth({
    config,
    registryUrl: REGISTRAR_URL,
  });

  if (registryAuth == null) {
    return {
      decision: "block",
      reason: formatError({
        message: `No registry authentication configured for ${REGISTRAR_URL}.\n\nAdd registry credentials to .nori-config.json:\n{\n  "registryAuths": [{\n    "username": "your-email@example.com",\n    "password": "your-password",\n    "registryUrl": "${REGISTRAR_URL}"\n  }]\n}`,
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
    });

    return {
      decision: "block",
      reason: formatSuccess({
        message: `Successfully uploaded "${profileName}@${result.version}" to the Nori registry.\n\nOthers can install it with:\n/nori-download-profile ${profileName}`,
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
    "^\\/nori-registry-upload\\s+[a-z0-9-]+(?:\\s+\\d+\\.\\d+\\.\\d+.*)?\\s*$", // With args
  ],
  run,
};
