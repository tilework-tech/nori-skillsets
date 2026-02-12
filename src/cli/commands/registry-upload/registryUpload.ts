/**
 * CLI command for uploading profile packages to the Nori registry
 * Handles: nori-skillsets upload <profile>[@version] [--registry <url>] [--list-versions]
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as semver from "semver";
import * as tar from "tar";

import {
  registrarApi,
  type SkillResolutionStrategy,
  type UploadSkillsetResponse,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { error, info } from "@/cli/logger.js";
import {
  uploadFlow,
  listVersionsFlow,
  type UploadResult,
} from "@/cli/prompts/flows/index.js";
import { isSkillCollisionError } from "@/utils/fetch.js";
import { getInstallDirs } from "@/utils/path.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { RegistryAuth } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Result of upload operation
 */
export type RegistryUploadResult = {
  success: boolean;
};

/**
 * Determine the version to upload (auto-bump if not specified)
 * @param args - The function arguments
 * @param args.profileName - The profile name
 * @param args.explicitVersion - Explicit version if provided
 * @param args.registryUrl - The registry URL
 * @param args.authToken - Auth token for the registry
 *
 * @returns The version to upload and whether this is a new package
 */
const determineUploadVersion = async (args: {
  profileName: string;
  explicitVersion?: string | null;
  registryUrl: string;
  authToken?: string | null;
}): Promise<{ version: string; isNewPackage: boolean }> => {
  const { profileName, explicitVersion, registryUrl, authToken } = args;

  if (explicitVersion != null) {
    return { version: explicitVersion, isNewPackage: false };
  }

  try {
    const packument = await registrarApi.getPackument({
      packageName: profileName,
      registryUrl,
      authToken,
    });

    const latestVersion = packument["dist-tags"].latest;
    if (latestVersion != null && semver.valid(latestVersion) != null) {
      const nextVersion = semver.inc(latestVersion, "patch");
      if (nextVersion != null) {
        return { version: nextVersion, isNewPackage: false };
      }
    }
  } catch {
    // Package doesn't exist - default to 1.0.0
  }

  return { version: "1.0.0", isNewPackage: true };
};

/**
 * Create a gzipped tarball from a profile directory
 * @param args - The function arguments
 * @param args.profileDir - The profile directory to pack
 *
 * @returns The tarball as a Buffer
 */
const createProfileTarball = async (args: {
  profileDir: string;
}): Promise<Buffer> => {
  const { profileDir } = args;

  const files = await fs.readdir(profileDir, { recursive: true });
  const filesToPack: Array<string> = [];

  for (const file of files) {
    const filePath = path.join(profileDir, file);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      filesToPack.push(file);
    }
  }

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

    return await fs.readFile(tempTarPath);
  } finally {
    await fs.unlink(tempTarPath).catch(() => {
      /* ignore cleanup errors */
    });
  }
};

/**
 * Main upload function
 * @param args - The function arguments
 * @param args.profileSpec - Profile specification (name[@version] or org/name[@version])
 * @param args.cwd - Current working directory
 * @param args.installDir - Custom installation directory
 * @param args.registryUrl - Target registry URL
 * @param args.listVersions - If true, list versions instead of uploading
 * @param args.nonInteractive - Run without prompts
 * @param args.silent - Suppress output
 * @param args.dryRun - Show what would happen without uploading
 * @param args.description - Description for the profile version
 *
 * @returns Upload result
 */
export const registryUploadMain = async (args: {
  profileSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
  dryRun?: boolean | null;
  description?: string | null;
}): Promise<RegistryUploadResult> => {
  const {
    profileSpec,
    installDir,
    registryUrl,
    listVersions,
    nonInteractive,
    silent,
    dryRun,
    description,
  } = args;
  const cwd = args.cwd ?? process.cwd();

  // Parse profile spec using shared utility
  const parsed = parseNamespacedPackage({ packageSpec: profileSpec });
  if (parsed == null) {
    error({
      message: `Invalid profile specification: "${profileSpec}".\nExpected format: profile-name or org/profile-name[@version]`,
    });
    return { success: false };
  }

  const { orgId, packageName, version } = parsed;
  const profileDisplayName =
    orgId === "public" ? packageName : `${orgId}/${packageName}`;

  // Validate Nori installation exists
  if (installDir == null) {
    const allInstallations = getInstallDirs({ currentDir: cwd });

    if (allInstallations.length === 0) {
      error({
        message: `No Nori installation found.\n\nRun 'nori-skillsets init' to initialize Nori.`,
      });
      return { success: false };
    }

    if (allInstallations.length > 1) {
      const installList = allInstallations
        .map((dir, index) => `${index + 1}. ${dir}`)
        .join("\n");

      error({
        message: `Found multiple Nori installations.\n\nInstallations found:\n${installList}\n\nUse --install-dir to specify which one to use.`,
      });
      return { success: false };
    }
  }

  // Load config
  const config = await loadConfig();
  if (config == null) {
    error({ message: `Could not load Nori configuration.` });
    return { success: false };
  }

  // Check for unified auth with organizations (new flow)
  const hasUnifiedAuthWithOrgs =
    config.auth != null &&
    config.auth.refreshToken != null &&
    config.auth.organizations != null;

  // Determine target registry and auth
  let targetRegistryUrl: string;
  let authToken: string;

  if (registryUrl != null) {
    // User specified a registry URL
    targetRegistryUrl = registryUrl;

    // Check unified auth first
    let registryAuth: RegistryAuth | null = null;
    if (hasUnifiedAuthWithOrgs) {
      const userOrgs = config.auth!.organizations!;
      for (const userOrgId of userOrgs) {
        const orgRegistryUrl = buildOrganizationRegistryUrl({
          orgId: userOrgId,
        });
        if (orgRegistryUrl === registryUrl) {
          registryAuth = {
            registryUrl,
            username: config.auth!.username,
            refreshToken: config.auth!.refreshToken,
          };
          break;
        }
      }
    }

    // Fall back to config-level registry auth
    if (registryAuth == null) {
      registryAuth = getRegistryAuth({ config, registryUrl });
    }

    if (registryAuth == null) {
      error({
        message: `No authentication configured for ${registryUrl}.\n\nLog in with 'nori-skillsets login' to configure registry access.`,
      });
      return { success: false };
    }

    try {
      authToken = await getRegistryAuthToken({ registryAuth });
    } catch (err) {
      error({
        message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { success: false };
    }
  } else if (hasUnifiedAuthWithOrgs) {
    // Derive registry from namespace
    targetRegistryUrl = buildOrganizationRegistryUrl({ orgId });
    const userOrgs = config.auth!.organizations!;

    // Check if user has access to this org
    if (!userOrgs.includes(orgId)) {
      error({
        message: `You do not have access to organization "${orgId}".\n\nCannot upload "${profileDisplayName}" to ${targetRegistryUrl}.\n\nYour available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
      });
      return { success: false };
    }

    const registryAuth: RegistryAuth = {
      registryUrl: targetRegistryUrl,
      username: config.auth!.username,
      refreshToken: config.auth!.refreshToken,
    };

    try {
      authToken = await getRegistryAuthToken({ registryAuth });
    } catch (err) {
      error({
        message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { success: false };
    }
  } else if (orgId === "public") {
    // Public registry requires auth for uploads
    error({
      message: `Authentication required to upload to public registry.\n\nLog in with 'nori-skillsets login' to configure registry access.`,
    });
    return { success: false };
  } else {
    // Namespaced package without unified auth
    error({
      message: `Cannot upload "${profileDisplayName}". To upload to organization "${orgId}", log in with:\n\n  nori-skillsets login`,
    });
    return { success: false };
  }

  // If --list-versions flag is set, use list versions flow
  if (listVersions) {
    const result = await listVersionsFlow({
      profileDisplayName,
      registryUrl: targetRegistryUrl,
      callbacks: {
        onFetchPackument: async () => {
          try {
            return await registrarApi.getPackument({
              packageName,
              registryUrl: targetRegistryUrl,
              authToken,
            });
          } catch {
            return null;
          }
        },
      },
    });

    return { success: result != null };
  }

  // Check profile exists locally
  const profilesDir = getNoriProfilesDir();
  const profileDir =
    orgId === "public"
      ? path.join(profilesDir, packageName)
      : path.join(profilesDir, orgId, packageName);

  try {
    await fs.access(profileDir);
  } catch {
    error({
      message: `Profile "${profileDisplayName}" not found at:\n${profileDir}`,
    });
    return { success: false };
  }

  // Handle dry-run mode (simple output, no flow)
  if (dryRun) {
    const versionResult = await determineUploadVersion({
      profileName: packageName,
      explicitVersion: version,
      registryUrl: targetRegistryUrl,
      authToken,
    });

    info({
      message: `[Dry run] Would upload "${profileDisplayName}@${versionResult.version}" to ${targetRegistryUrl}`,
    });
    info({
      message: `[Dry run] Profile path: ${profileDir}`,
    });
    return { success: true };
  }

  // Helper to perform upload with optional resolution strategy
  const performUpload = async (uploadArgs: {
    resolutionStrategy?: SkillResolutionStrategy | null;
    uploadVersion: string;
  }): Promise<UploadResult> => {
    try {
      const tarballBuffer = await createProfileTarball({ profileDir });
      const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
      new Uint8Array(archiveData).set(tarballBuffer);

      const result: UploadSkillsetResponse = await registrarApi.uploadSkillset({
        packageName,
        version: uploadArgs.uploadVersion,
        archiveData,
        authToken,
        registryUrl: targetRegistryUrl,
        description: description ?? undefined,
        resolutionStrategy: uploadArgs.resolutionStrategy ?? undefined,
      });

      return {
        success: true,
        version: result.version,
        extractedSkills: result.extractedSkills,
      };
    } catch (err) {
      if (isSkillCollisionError(err)) {
        return {
          success: false,
          conflicts: err.conflicts,
        };
      }

      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Silent mode: direct upload without UI
  if (silent) {
    const versionResult = await determineUploadVersion({
      profileName: packageName,
      explicitVersion: version,
      registryUrl: targetRegistryUrl,
      authToken,
    });

    const uploadResult = await performUpload({
      uploadVersion: versionResult.version,
    });

    return { success: uploadResult.success };
  }

  // Use the upload flow for interactive upload
  // Store upload version for callbacks closure
  let uploadVersion: string | null = null;

  const result = await uploadFlow({
    profileDisplayName,
    profileName: packageName,
    registryUrl: targetRegistryUrl,
    nonInteractive: nonInteractive ?? false,
    callbacks: {
      onDetermineVersion: async () => {
        const versionResult = await determineUploadVersion({
          profileName: packageName,
          explicitVersion: version,
          registryUrl: targetRegistryUrl,
          authToken,
        });
        uploadVersion = versionResult.version;
        return versionResult;
      },
      onUpload: async (uploadCallbackArgs) => {
        if (uploadVersion == null) {
          return { success: false, error: "Version not determined" };
        }
        return performUpload({
          resolutionStrategy: uploadCallbackArgs.resolutionStrategy,
          uploadVersion,
        });
      },
    },
  });

  return { success: result != null };
};

/**
 * Register the 'upload' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistryUploadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("upload <profile>")
    .description("Upload a profile to the Nori registry")
    .option("--registry <url>", "Upload to a specific registry URL")
    .option(
      "--list-versions",
      "List available versions for the profile instead of uploading",
    )
    .option("--dry-run", "Show what would be uploaded without uploading")
    .option("--description <text>", "Description for this version")
    .action(
      async (
        profileSpec: string,
        options: {
          registry?: string;
          listVersions?: boolean;
          dryRun?: boolean;
          description?: string;
        },
      ) => {
        const globalOpts = program.opts();

        const result = await registryUploadMain({
          profileSpec,
          cwd: process.cwd(),
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
          nonInteractive: globalOpts.nonInteractive || null,
          silent: globalOpts.silent || null,
          dryRun: options.dryRun || null,
          description: options.description || null,
        });

        if (!result.success) {
          process.exit(1);
        }
      },
    );
};
