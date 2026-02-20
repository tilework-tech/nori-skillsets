/**
 * CLI command for uploading skillset packages to the Nori registry
 * Handles: nori-skillsets upload <skillset>[@version] [--registry <url>] [--list-versions]
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import * as semver from "semver";
import * as tar from "tar";

import {
  registrarApi,
  type SkillResolutionStrategy,
  type UploadSkillsetResponse,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import { getNoriSkillsetsDir } from "@/cli/features/claude-code/paths.js";
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
import type { NoriJson } from "@/norijson/nori.js";
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
 * @param args.skillsetName - The skillset name
 * @param args.explicitVersion - Explicit version if provided
 * @param args.registryUrl - The registry URL
 * @param args.authToken - Auth token for the registry
 *
 * @returns The version to upload and whether this is a new package
 */
const determineUploadVersion = async (args: {
  skillsetName: string;
  explicitVersion?: string | null;
  registryUrl: string;
  authToken?: string | null;
}): Promise<{ version: string; isNewPackage: boolean }> => {
  const { skillsetName, explicitVersion, registryUrl, authToken } = args;

  if (explicitVersion != null) {
    return { version: explicitVersion, isNewPackage: false };
  }

  try {
    const packument = await registrarApi.getPackument({
      packageName: skillsetName,
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
 * Files to exclude from upload tarballs.
 * .nori-version contains local download metadata that should not be distributed.
 */
const UPLOAD_EXCLUDED_FILES = new Set([".nori-version"]);

/**
 * Create a gzipped tarball from a skillset directory
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory to pack
 *
 * @returns The tarball as a Buffer
 */
const createProfileTarball = async (args: {
  skillsetDir: string;
}): Promise<Buffer> => {
  const { skillsetDir } = args;

  const files = await fs.readdir(skillsetDir, { recursive: true });
  const filesToPack: Array<string> = [];

  for (const file of files) {
    const filePath = path.join(skillsetDir, file);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      // Skip excluded files (like .nori-version)
      const filename = path.basename(file);
      if (UPLOAD_EXCLUDED_FILES.has(filename)) {
        continue;
      }
      filesToPack.push(file);
    }
  }

  const tempTarPath = path.join(
    skillsetDir,
    "..",
    `.${path.basename(skillsetDir)}-upload.tgz`,
  );

  try {
    await tar.create(
      {
        gzip: true,
        file: tempTarPath,
        cwd: skillsetDir,
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
 * Detect skills in a skillset that don't have a nori.json file.
 * These are candidates for keeping inline (bundled in the tarball)
 * rather than being extracted as independent skill packages.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory to scan
 *
 * @returns Array of skill IDs that are inline candidates, or empty array
 */
const detectInlineSkillCandidates = async (args: {
  skillsetDir: string;
}): Promise<Array<string>> => {
  const { skillsetDir } = args;
  const skillsDir = path.join(skillsetDir, "skills");

  try {
    await fs.access(skillsDir);
  } catch {
    return [];
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const candidates: Array<string> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const noriJsonPath = path.join(skillsDir, entry.name, "nori.json");
    try {
      await fs.access(noriJsonPath);
    } catch {
      candidates.push(entry.name);
    }
  }

  return candidates;
};

/**
 * Backfill the `type` field on nori.json files before upload.
 *
 * - Sets `type: "skillset"` on the skillset's nori.json if missing
 * - Sets `type: "skill"` on any skill subdirectory nori.json if missing
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 */
const backfillNoriJsonTypes = async (args: {
  skillsetDir: string;
}): Promise<void> => {
  const { skillsetDir } = args;

  // Backfill skillset nori.json
  const profileNoriJsonPath = path.join(skillsetDir, "nori.json");
  try {
    const content = await fs.readFile(profileNoriJsonPath, "utf-8");
    const metadata = JSON.parse(content) as NoriJson;
    if (metadata.type == null) {
      metadata.type = "skillset";
      await fs.writeFile(
        profileNoriJsonPath,
        JSON.stringify(metadata, null, 2),
      );
    }
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `nori.json exists but contains invalid JSON: ${err.message}`,
      );
    }
    // No nori.json — nothing to backfill
  }

  // Backfill skill subdirectory nori.json files
  const skillsDir = path.join(skillsetDir, "skills");
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillNoriJsonPath = path.join(skillsDir, entry.name, "nori.json");
      try {
        const content = await fs.readFile(skillNoriJsonPath, "utf-8");
        const metadata = JSON.parse(content) as NoriJson;
        if (metadata.type == null) {
          metadata.type = "skill";
          await fs.writeFile(
            skillNoriJsonPath,
            JSON.stringify(metadata, null, 2),
          );
        }
      } catch (err: unknown) {
        if (err instanceof SyntaxError) {
          throw new Error(
            `skills/${entry.name}/nori.json exists but contains invalid JSON: ${err.message}`,
          );
        }
        // No nori.json for this skill — skip
      }
    }
  } catch {
    // No skills directory — nothing to backfill
  }
};

/**
 * Create nori.json files for inline/extract skill candidates after resolution.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 * @param args.inlineCandidates - All skill IDs that were candidates (no nori.json)
 * @param args.inlineSkillIds - Skill IDs that were chosen to be kept inline
 */
const createCandidateNoriJsonFiles = async (args: {
  skillsetDir: string;
  inlineCandidates: Array<string>;
  inlineSkillIds: Array<string>;
}): Promise<void> => {
  const { skillsetDir, inlineCandidates, inlineSkillIds } = args;
  const inlineSet = new Set(inlineSkillIds);

  for (const candidate of inlineCandidates) {
    const skillDir = path.join(skillsetDir, "skills", candidate);
    const noriJsonPath = path.join(skillDir, "nori.json");
    const type = inlineSet.has(candidate) ? "inlined-skill" : "skill";
    const metadata: NoriJson = {
      name: candidate,
      version: "1.0.0",
      type,
    };
    await fs.writeFile(noriJsonPath, JSON.stringify(metadata, null, 2));
  }
};

/**
 * Main upload function
 * @param args - The function arguments
 * @param args.profileSpec - Skillset specification (name[@version] or org/name[@version])
 * @param args.cwd - Current working directory
 * @param args.installDir - Custom installation directory
 * @param args.registryUrl - Target registry URL
 * @param args.listVersions - If true, list versions instead of uploading
 * @param args.nonInteractive - Run without prompts
 * @param args.silent - Suppress output
 * @param args.dryRun - Show what would happen without uploading
 * @param args.description - Description for the skillset version
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

  // Parse skillset spec using shared utility
  const parsed = parseNamespacedPackage({ packageSpec: profileSpec });
  if (parsed == null) {
    log.error(
      `Invalid skillset specification: "${profileSpec}".\nExpected format: skillset-name or org/skillset-name[@version]`,
    );
    return { success: false };
  }

  const { orgId, packageName, version } = parsed;
  const profileDisplayName =
    orgId === "public" ? packageName : `${orgId}/${packageName}`;

  // Validate Nori installation exists
  if (installDir == null) {
    const allInstallations = getInstallDirs({ currentDir: cwd });

    if (allInstallations.length === 0) {
      log.error(
        `No Nori installation found.\n\nRun 'nori-skillsets init' to initialize Nori.`,
      );
      return { success: false };
    }

    if (allInstallations.length > 1) {
      const installList = allInstallations
        .map((dir, index) => `${index + 1}. ${dir}`)
        .join("\n");

      log.error(
        `Found multiple Nori installations.\n\nInstallations found:\n${installList}\n\nUse --install-dir to specify which one to use.`,
      );
      return { success: false };
    }
  }

  // Load config - use getHomeDir() since registry upload needs global auth
  const config = await loadConfig();
  if (config == null) {
    log.error(`Could not load Nori configuration.`);
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
      log.error(
        `No authentication configured for ${registryUrl}.\n\nLog in with 'nori-skillsets login' to configure registry access.`,
      );
      return { success: false };
    }

    try {
      authToken = await getRegistryAuthToken({ registryAuth });
    } catch (err) {
      log.error(
        `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { success: false };
    }
  } else if (hasUnifiedAuthWithOrgs) {
    // Derive registry from namespace
    targetRegistryUrl = buildOrganizationRegistryUrl({ orgId });
    const userOrgs = config.auth!.organizations!;

    // Check if user has access to this org
    if (!userOrgs.includes(orgId)) {
      log.error(
        `You do not have access to organization "${orgId}".\n\nCannot upload "${profileDisplayName}" to ${targetRegistryUrl}.\n\nYour available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
      );
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
      log.error(
        `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { success: false };
    }
  } else if (orgId === "public") {
    // Public registry requires auth for uploads
    log.error(
      `Authentication required to upload to public registry.\n\nLog in with 'nori-skillsets login' to configure registry access.`,
    );
    return { success: false };
  } else {
    // Namespaced package without unified auth
    log.error(
      `Cannot upload "${profileDisplayName}". To upload to organization "${orgId}", log in with:\n\n  nori-skillsets login`,
    );
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

  // Check skillset exists locally
  const skillsetsDir = getNoriSkillsetsDir();
  const skillsetDir =
    orgId === "public"
      ? path.join(skillsetsDir, packageName)
      : path.join(skillsetsDir, orgId, packageName);

  try {
    await fs.access(skillsetDir);
  } catch {
    log.error(`Skillset "${profileDisplayName}" not found at:\n${skillsetDir}`);
    return { success: false };
  }

  // Handle dry-run mode (simple output, no flow)
  if (dryRun) {
    const versionResult = await determineUploadVersion({
      skillsetName: packageName,
      explicitVersion: version,
      registryUrl: targetRegistryUrl,
      authToken,
    });

    log.info(
      `[Dry run] Would upload "${profileDisplayName}@${versionResult.version}" to ${targetRegistryUrl}`,
    );
    log.info(`[Dry run] Skillset path: ${skillsetDir}`);
    return { success: true };
  }

  // Backfill type field on existing nori.json files before upload
  await backfillNoriJsonTypes({ skillsetDir });

  // Detect inline skill candidates (skills without nori.json)
  const inlineCandidates = await detectInlineSkillCandidates({ skillsetDir });

  // Helper to perform upload with optional resolution strategy
  const performUpload = async (uploadArgs: {
    resolutionStrategy?: SkillResolutionStrategy | null;
    inlineSkills?: Array<string> | null;
    uploadVersion: string;
  }): Promise<UploadResult> => {
    try {
      // Create nori.json for inline/extract candidates before tarball creation
      if (inlineCandidates.length > 0) {
        await createCandidateNoriJsonFiles({
          skillsetDir,
          inlineCandidates,
          inlineSkillIds: uploadArgs.inlineSkills ?? [],
        });
      }

      const tarballBuffer = await createProfileTarball({ skillsetDir });
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
        inlineSkills: uploadArgs.inlineSkills ?? undefined,
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
      skillsetName: packageName,
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
    skillsetName: packageName,
    registryUrl: targetRegistryUrl,
    nonInteractive: nonInteractive ?? false,
    inlineCandidates:
      inlineCandidates.length > 0 ? inlineCandidates : undefined,
    callbacks: {
      onDetermineVersion: async () => {
        const versionResult = await determineUploadVersion({
          skillsetName: packageName,
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
          inlineSkills: uploadCallbackArgs.inlineSkillIds,
          uploadVersion,
        });
      },
      onReadLocalSkillMd: async ({ skillId }) => {
        const skillMdPath = path.join(
          skillsetDir,
          "skills",
          skillId,
          "SKILL.md",
        );
        try {
          return await fs.readFile(skillMdPath, "utf-8");
        } catch {
          return null;
        }
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
    .description("Upload a skillset to the Nori registry")
    .option("--registry <url>", "Upload to a specific registry URL")
    .option(
      "--list-versions",
      "List available versions for the skillset instead of uploading",
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
