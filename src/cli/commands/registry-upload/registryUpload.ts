/**
 * CLI command for uploading profile packages to the Nori registry
 * Handles: nori-skillsets upload <profile>[@version] [--registry <url>] [--list-versions]
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as clack from "@clack/prompts";
import * as semver from "semver";
import * as tar from "tar";

import {
  registrarApi,
  type SkillConflict,
  type SkillResolutionStrategy,
  type UploadProfileResponse,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { error, success, info, raw } from "@/cli/logger.js";
import { selectSkillResolution } from "@/cli/prompts/skillResolution.js";
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
 * @returns The version to upload
 */
const determineUploadVersion = async (args: {
  profileName: string;
  explicitVersion?: string | null;
  registryUrl: string;
  authToken?: string | null;
}): Promise<string> => {
  const { profileName, explicitVersion, registryUrl, authToken } = args;

  if (explicitVersion != null) {
    return explicitVersion;
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
        return nextVersion;
      }
    }
  } catch {
    // Package doesn't exist - default to 1.0.0
  }

  return "1.0.0";
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
 * Check if a conflict can be auto-resolved
 * @param args - The function arguments
 * @param args.conflict - The skill conflict
 *
 * @returns True if can be auto-resolved
 */
const canAutoResolveConflict = (args: { conflict: SkillConflict }): boolean => {
  const { conflict } = args;
  return (
    conflict.contentUnchanged === true &&
    conflict.availableActions.includes("link")
  );
};

/**
 * Build auto-resolution strategy for conflicts
 * @param args - The function arguments
 * @param args.conflicts - Array of skill conflicts
 *
 * @returns Strategy and unresolved conflicts
 */
const buildAutoResolutionStrategy = (args: {
  conflicts: Array<SkillConflict>;
}): {
  strategy: SkillResolutionStrategy;
  unresolvedConflicts: Array<SkillConflict>;
} => {
  const { conflicts } = args;
  const strategy: SkillResolutionStrategy = {};
  const unresolvedConflicts: Array<SkillConflict> = [];

  for (const conflict of conflicts) {
    if (canAutoResolveConflict({ conflict })) {
      strategy[conflict.skillId] = { action: "link" };
    } else {
      unresolvedConflicts.push(conflict);
    }
  }

  return { strategy, unresolvedConflicts };
};

/**
 * Format skill conflicts for display
 * @param args - The function arguments
 * @param args.conflicts - Array of skill conflicts
 *
 * @returns Formatted string
 */
const formatSkillConflicts = (args: {
  conflicts: Array<SkillConflict>;
}): string => {
  const { conflicts } = args;
  const lines: Array<string> = ["Skill conflicts detected:\n"];

  for (const conflict of conflicts) {
    const status =
      conflict.contentUnchanged === true
        ? "(unchanged) - will link to existing"
        : "(MODIFIED) - requires resolution";
    lines.push(`  ${conflict.skillId} ${status}`);
    if (conflict.latestVersion != null) {
      lines.push(`    Current: v${conflict.latestVersion}`);
    }
    if (conflict.owner != null) {
      lines.push(`    Owner: ${conflict.owner}`);
    }
    lines.push(
      `    Available actions: ${conflict.availableActions.join(", ")}\n`,
    );
  }

  lines.push("\nManual resolution required for modified skills.");
  lines.push(
    "Consider renaming the skill in your profile to avoid the conflict,",
  );
  lines.push("or contact the skill owner to coordinate versioning.");

  return lines.join("\n");
};

/**
 * Format the list of available versions for a package
 * @param args - The function arguments
 * @param args.profileName - The profile name
 * @param args.packument - The packument data containing version information
 * @param args.packument.versions - Map of version strings to version metadata
 * @param args.packument.time - Optional map of version strings to publish timestamps
 * @param args.registryUrl - The registry URL
 *
 * @returns Formatted version list
 */
const formatVersionList = (args: {
  profileName: string;
  packument: {
    "dist-tags": Record<string, string>;
    versions: Record<string, unknown>;
    time?: Record<string, string> | null;
  };
  registryUrl: string;
}): string => {
  const { profileName, packument, registryUrl } = args;
  const distTags = packument["dist-tags"];
  const versions = Object.keys(packument.versions);
  const timeInfo = packument.time ?? {};

  // Sort versions in descending order (newest first)
  const sortedVersions = versions.sort((a, b) => {
    const timeA = timeInfo[a] ? new Date(timeInfo[a]).getTime() : 0;
    const timeB = timeInfo[b] ? new Date(timeInfo[b]).getTime() : 0;
    return timeB - timeA;
  });

  const lines = [
    `Available versions of "${profileName}" from ${registryUrl}:\n`,
    "Dist-tags:",
  ];

  for (const [tag, version] of Object.entries(distTags)) {
    lines.push(`  ${tag}: ${version}`);
  }

  lines.push("\nVersions:");

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
    `\nTo upload a specific version:\n  nori-skillsets upload ${profileName}@<version>`,
  );

  return lines.join("\n");
};

/**
 * Format skill summary for display
 * @param args - The function arguments
 * @param args.result - The upload response
 * @param args.linkedSkillIds - Set of skill IDs that were linked (not uploaded fresh)
 *
 * @returns Formatted skill summary string or null if no skills
 */
const formatSkillSummary = (args: {
  result: UploadProfileResponse;
  linkedSkillIds: Set<string>;
}): string | null => {
  const { result, linkedSkillIds } = args;

  if (result.extractedSkills == null) {
    return null;
  }

  const { succeeded, failed } = result.extractedSkills;

  if (succeeded.length === 0 && failed.length === 0) {
    return null;
  }

  const lines: Array<string> = ["\nSkills:"];

  // Separate linked vs newly uploaded skills
  const linkedSkills = succeeded.filter((s) => linkedSkillIds.has(s.name));
  const uploadedSkills = succeeded.filter((s) => !linkedSkillIds.has(s.name));

  if (uploadedSkills.length > 0) {
    lines.push("  Uploaded:");
    for (const skill of uploadedSkills) {
      lines.push(`    - ${skill.name}@${skill.version}`);
    }
  }

  if (linkedSkills.length > 0) {
    lines.push("  Linked (existing):");
    for (const skill of linkedSkills) {
      lines.push(`    - ${skill.name}@${skill.version}`);
    }
  }

  if (failed.length > 0) {
    lines.push("  Failed:");
    for (const skill of failed) {
      lines.push(`    - ${skill.name}: ${skill.error}`);
    }
  }

  return lines.join("\n");
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

  // Find installation directory
  let targetInstallDir: string;

  if (installDir != null) {
    targetInstallDir = installDir;
  } else {
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

    targetInstallDir = allInstallations[0];
  }

  // Load config
  const config = await loadConfig({ installDir: targetInstallDir });
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

  // If --list-versions flag is set, show versions and exit
  if (listVersions) {
    try {
      const packument = await registrarApi.getPackument({
        packageName,
        registryUrl: targetRegistryUrl,
        authToken,
      });

      raw({
        message: formatVersionList({
          profileName: profileDisplayName,
          packument,
          registryUrl: targetRegistryUrl,
        }),
      });
      return { success: true };
    } catch {
      error({
        message: `Profile "${profileDisplayName}" not found in ${targetRegistryUrl}.`,
      });
      return { success: false };
    }
  }

  // Check profile exists locally
  const profilesDir = getNoriProfilesDir({ installDir: targetInstallDir });
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

  // Determine version to upload
  const uploadVersion = await determineUploadVersion({
    profileName: packageName,
    explicitVersion: version,
    registryUrl: targetRegistryUrl,
    authToken,
  });

  // Handle dry-run mode
  if (dryRun) {
    info({
      message: `[Dry run] Would upload "${profileDisplayName}@${uploadVersion}" to ${targetRegistryUrl}`,
    });
    info({
      message: `[Dry run] Profile path: ${profileDir}`,
    });
    return { success: true };
  }

  // Create spinner for progress (unless in silent mode)
  const uploadSpinner = silent ? null : clack.spinner();

  // Track linked skill IDs for summary
  const linkedSkillIds = new Set<string>();

  // Helper to perform upload with optional resolution strategy
  const performUpload = async (args: {
    resolutionStrategy?: SkillResolutionStrategy | null;
  }): Promise<UploadProfileResponse> => {
    const tarballBuffer = await createProfileTarball({ profileDir });
    const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
    new Uint8Array(archiveData).set(tarballBuffer);

    return await registrarApi.uploadProfile({
      packageName,
      version: uploadVersion,
      archiveData,
      authToken,
      registryUrl: targetRegistryUrl,
      description: description ?? undefined,
      resolutionStrategy: args.resolutionStrategy ?? undefined,
    });
  };

  // Helper to display success and summary
  const displaySuccess = (args: { result: UploadProfileResponse }): void => {
    const { result } = args;

    success({
      message: `Successfully uploaded "${profileDisplayName}@${result.version}" to ${targetRegistryUrl}`,
    });

    // Show skill summary if available
    const skillSummary = formatSkillSummary({
      result,
      linkedSkillIds,
    });
    if (skillSummary != null) {
      info({ message: skillSummary });
    }

    info({
      message: `Others can install it with:\n  nori-skillsets download ${profileDisplayName}`,
    });
  };

  // Start spinner
  uploadSpinner?.start(`Uploading "${profileDisplayName}@${uploadVersion}"...`);

  try {
    const result = await performUpload({});

    uploadSpinner?.stop(`Upload complete`);
    displaySuccess({ result });

    return { success: true };
  } catch (err) {
    // Handle skill collision errors
    if (isSkillCollisionError(err)) {
      const { strategy, unresolvedConflicts } = buildAutoResolutionStrategy({
        conflicts: err.conflicts,
      });

      // Track which skills were linked for summary
      for (const [skillId, resolution] of Object.entries(strategy)) {
        if (resolution.action === "link") {
          linkedSkillIds.add(skillId);
        }
      }

      // Auto-resolve if all conflicts are resolvable
      if (unresolvedConflicts.length === 0) {
        try {
          uploadSpinner?.message(
            `Auto-resolving ${Object.keys(strategy).length} unchanged skill conflict(s)...`,
          );

          const retryResult = await performUpload({
            resolutionStrategy: strategy,
          });

          uploadSpinner?.stop(`Upload complete`);

          success({
            message: `Successfully uploaded "${profileDisplayName}@${retryResult.version}" to ${targetRegistryUrl}`,
          });
          info({
            message: `Auto-resolved ${Object.keys(strategy).length} skill(s) by linking to existing versions.`,
          });

          // Show skill summary if available
          const skillSummary = formatSkillSummary({
            result: retryResult,
            linkedSkillIds,
          });
          if (skillSummary != null) {
            info({ message: skillSummary });
          }

          info({
            message: `Others can install it with:\n  nori-skillsets download ${profileDisplayName}`,
          });

          return { success: true };
        } catch (retryErr) {
          uploadSpinner?.stop(`Upload failed`);
          error({
            message: `Upload failed on retry: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          });
          return { success: false };
        }
      }

      // Interactive resolution if not in non-interactive mode
      if (!nonInteractive) {
        uploadSpinner?.stop(`Skill conflicts detected`);

        try {
          // Prompt for resolution of unresolved conflicts
          const interactiveStrategy = await selectSkillResolution({
            conflicts: unresolvedConflicts,
            profileName: packageName,
          });

          // Merge auto-resolved and interactive strategies
          const combinedStrategy: SkillResolutionStrategy = {
            ...strategy,
            ...interactiveStrategy,
          };

          // Track linked skills from interactive resolution
          for (const [skillId, resolution] of Object.entries(
            interactiveStrategy,
          )) {
            if (resolution.action === "link") {
              linkedSkillIds.add(skillId);
            }
          }

          uploadSpinner?.start(`Uploading with resolution strategy...`);

          const retryResult = await performUpload({
            resolutionStrategy: combinedStrategy,
          });

          uploadSpinner?.stop(`Upload complete`);
          displaySuccess({ result: retryResult });

          return { success: true };
        } catch (resolutionErr) {
          // User cancelled or error during resolution
          uploadSpinner?.stop(`Upload cancelled`);
          error({
            message: `Upload cancelled: ${resolutionErr instanceof Error ? resolutionErr.message : String(resolutionErr)}`,
          });
          return { success: false };
        }
      }

      // Non-interactive mode - manual resolution required
      uploadSpinner?.stop(`Upload failed`);
      error({ message: formatSkillConflicts({ conflicts: err.conflicts }) });
      return { success: false };
    }

    uploadSpinner?.stop(`Upload failed`);
    error({
      message: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { success: false };
  }
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
