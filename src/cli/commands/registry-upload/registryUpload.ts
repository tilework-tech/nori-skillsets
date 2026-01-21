/**
 * CLI command for uploading profile packages to the Nori registrar
 * Handles: nori-ai registry-upload <profile>[@version] [--registry <url>]
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as semver from "semver";
import * as tar from "tar";

import { registrarApi } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import {
  checkRegistryAgentSupport,
  showCursorAgentNotSupportedError,
} from "@/cli/commands/registryAgentCheck.js";
import { getRegistryAuth } from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { error, success, info, newline } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";
import { extractOrgId, buildRegistryUrl } from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Parse profile name and optional version from profile spec
 * Supports formats: "profile-name" or "profile-name@1.0.0"
 * @param args - The parsing parameters
 * @param args.profileSpec - Profile specification string
 *
 * @returns Parsed profile name and optional version
 */
const parseProfileSpec = (args: {
  profileSpec: string;
}): { profileName: string; version?: string | null } => {
  const { profileSpec } = args;
  const match = profileSpec.match(/^([a-z0-9-]+)(?:@(\d+\.\d+\.\d+.*))?$/i);

  if (!match) {
    return { profileName: profileSpec, version: null };
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
 * Format error message when multiple registries are available
 * @param args - The function arguments
 * @param args.profileName - The profile name to upload
 * @param args.registries - The available registries
 * @param args.cliName - The CLI name for command hints
 *
 * @returns Formatted error message
 */
const formatMultipleRegistriesError = (args: {
  profileName: string;
  registries: Array<RegistryAuth>;
  cliName?: CliName | null;
}): string => {
  const { profileName, registries, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-ai";

  const lines = [
    "Multiple registries configured. Please specify which registry to upload to.\n",
    "Available registries:",
  ];

  for (const registry of registries) {
    lines.push(`  -> ${registry.registryUrl}`);
  }

  lines.push("\nTo upload, specify the registry with --registry:");
  for (const registry of registries) {
    lines.push(
      `${cliPrefix} ${commandNames.upload} ${profileName} --registry ${registry.registryUrl}`,
    );
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
  authToken: string;
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
 * Upload a profile to the registrar
 * @param args - The upload parameters
 * @param args.profileSpec - Profile name with optional version (e.g., "my-profile" or "my-profile@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL to upload to
 * @param args.cliName - CLI name for user-facing messages (nori-ai or seaweed)
 */
export const registryUploadMain = async (args: {
  profileSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  cliName?: CliName | null;
}): Promise<void> => {
  const { profileSpec, installDir, registryUrl, cliName } = args;
  const cwd = args.cwd ?? process.cwd();
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-ai";

  const { profileName, version } = parseProfileSpec({ profileSpec });

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

  const profilesDir = getNoriProfilesDir({ installDir: targetInstallDir });
  const profileDir = path.join(profilesDir, profileName);

  // Check if profile exists
  try {
    await fs.access(profileDir);
  } catch {
    error({
      message: `Profile "${profileName}" not found at:\n${profileDir}`,
    });
    return;
  }

  // Get available registries - include both legacy registryAuths and org-based auth
  const availableRegistries: Array<RegistryAuth> = [];

  // Add registry derived from org-based auth (config.auth)
  if (config?.auth != null && config.auth.organizationUrl != null) {
    const orgId = extractOrgId({ url: config.auth.organizationUrl });
    if (orgId != null) {
      const derivedRegistryUrl = buildRegistryUrl({ orgId });
      availableRegistries.push({
        registryUrl: derivedRegistryUrl,
        username: config.auth.username,
        password: config.auth.password ?? null,
        refreshToken: config.auth.refreshToken ?? null,
      });
    }
  }

  // Add legacy registryAuths entries
  if (config?.registryAuths != null) {
    for (const auth of config.registryAuths) {
      // Avoid duplicates if the same registry URL already exists from org-based auth
      const alreadyExists = availableRegistries.some(
        (existing) => existing.registryUrl === auth.registryUrl,
      );
      if (!alreadyExists) {
        availableRegistries.push(auth);
      }
    }
  }

  if (availableRegistries.length === 0) {
    error({
      message: `No registry authentication configured.\n\nEither log in with 'nori-ai install' or add registry credentials to .nori-config.json:\n{\n  "registryAuths": [{\n    "username": "your-email@example.com",\n    "password": "your-password",\n    "registryUrl": "https://registry.example.com"\n  }]\n}`,
    });
    return;
  }

  // Determine target registry
  let targetRegistryUrl: string;
  let registryAuth: RegistryAuth | null;

  if (registryUrl != null) {
    // User specified a registry URL - validate it exists in config
    registryAuth =
      config != null ? getRegistryAuth({ config, registryUrl }) : null;
    if (registryAuth == null) {
      error({
        message: `No registry authentication configured for ${registryUrl}.\n\nAdd credentials to .nori-config.json or use one of the configured registries.`,
      });
      return;
    }
    targetRegistryUrl = registryUrl;
  } else if (availableRegistries.length === 1) {
    // Single registry - use it
    registryAuth = availableRegistries[0];
    targetRegistryUrl = registryAuth.registryUrl;
  } else {
    // Multiple registries - require explicit selection
    error({
      message: formatMultipleRegistriesError({
        profileName,
        registries: availableRegistries,
        cliName,
      }),
    });
    return;
  }

  // Get auth token
  let authToken: string;
  try {
    authToken = await getRegistryAuthToken({ registryAuth });
  } catch (err) {
    error({
      message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
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
    info({ message: `Uploading profile "${profileName}@${uploadVersion}"...` });

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

    newline();
    success({
      message: `Successfully uploaded "${profileName}@${result.version}" to ${targetRegistryUrl}`,
    });
    newline();
    info({
      message: `Others can install it with '${cliPrefix} ${commandNames.download} ${profileName}'.`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to upload profile "${profileName}": ${errorMessage}`,
    });
  }
};

/**
 * Register the 'registry-upload' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistryUploadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("registry-upload <profile>")
    .description("Upload a profile package to the Nori registrar")
    .option(
      "--registry <url>",
      "Upload to a specific registry URL instead of the default",
    )
    .action(async (profileSpec: string, options: { registry?: string }) => {
      const globalOpts = program.opts();

      await registryUploadMain({
        profileSpec,
        installDir: globalOpts.installDir || null,
        registryUrl: options.registry || null,
      });
    });
};
