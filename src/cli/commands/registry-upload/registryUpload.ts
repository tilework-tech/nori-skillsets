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
  type SubagentResolutionStrategy,
  type SubagentConflict,
  type UploadSkillsetResponse,
  type ExtractedSkillsSummary,
  type ExtractedSubagentsSummary,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { loadConfig, getRegistryAuth } from "@/cli/config.js";
import { bold } from "@/cli/logger.js";
import {
  uploadFlow,
  listVersionsFlow,
  type UploadResult,
} from "@/cli/prompts/flows/index.js";
import {
  readSkillsetMetadata,
  writeSkillsetMetadata,
} from "@/norijson/nori.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import {
  isSkillCollisionError,
  isSubagentCollisionError,
} from "@/utils/fetch.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { RegistryAuth } from "@/cli/config.js";
import type { NoriJson } from "@/norijson/nori.js";
import type { Command } from "commander";

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
 * Detect skills that already have nori.json with type "inlined-skill".
 * These were previously inlined and should remain inline on re-upload
 * without re-prompting the user.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory to scan
 *
 * @returns Array of skill IDs that are already marked as inlined
 */
const detectExistingInlineSkills = async (args: {
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
  const inlineSkills: Array<string> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const noriJsonPath = path.join(skillsDir, entry.name, "nori.json");
    try {
      const content = await fs.readFile(noriJsonPath, "utf-8");
      const metadata = JSON.parse(content) as NoriJson;
      if (metadata.type === "inlined-skill") {
        inlineSkills.push(entry.name);
      }
    } catch {
      // No nori.json or invalid JSON — skip
    }
  }

  return inlineSkills;
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

  // Backfill subagent subdirectory nori.json files
  const subagentsDir = path.join(skillsetDir, "subagents");
  try {
    const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subagentNoriJsonPath = path.join(
        subagentsDir,
        entry.name,
        "nori.json",
      );
      try {
        const content = await fs.readFile(subagentNoriJsonPath, "utf-8");
        const metadata = JSON.parse(content) as NoriJson;
        if (metadata.type == null) {
          metadata.type = "subagent";
          await fs.writeFile(
            subagentNoriJsonPath,
            JSON.stringify(metadata, null, 2),
          );
        }
      } catch (err: unknown) {
        if (err instanceof SyntaxError) {
          throw new Error(
            `subagents/${entry.name}/nori.json exists but contains invalid JSON: ${err.message}`,
          );
        }
        // No nori.json for this subagent — skip
      }
    }
  } catch {
    // No subagents directory — nothing to backfill
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
 * Detect directory-based subagents that don't have a nori.json file.
 * Only directories containing SUBAGENT.md are considered subagent directories.
 * Flat .md files are NOT candidates (they are always inlined).
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory to scan
 *
 * @returns Array of subagent IDs that are inline candidates, or empty array
 */
const detectInlineSubagentCandidates = async (args: {
  skillsetDir: string;
}): Promise<Array<string>> => {
  const { skillsetDir } = args;
  const subagentsDir = path.join(skillsetDir, "subagents");

  try {
    await fs.access(subagentsDir);
  } catch {
    return [];
  }

  const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
  const candidates: Array<string> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Only directories with SUBAGENT.md are subagent directories
    const subagentMdPath = path.join(subagentsDir, entry.name, "SUBAGENT.md");
    try {
      await fs.access(subagentMdPath);
    } catch {
      continue;
    }

    // Check if it already has a nori.json
    const noriJsonPath = path.join(subagentsDir, entry.name, "nori.json");
    try {
      await fs.access(noriJsonPath);
    } catch {
      candidates.push(entry.name);
    }
  }

  return candidates;
};

/**
 * Detect subagents that already have nori.json with type "inlined-subagent".
 * These were previously inlined and should remain inline on re-upload
 * without re-prompting the user.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory to scan
 *
 * @returns Array of subagent IDs that are already marked as inlined
 */
const detectExistingInlineSubagents = async (args: {
  skillsetDir: string;
}): Promise<Array<string>> => {
  const { skillsetDir } = args;
  const subagentsDir = path.join(skillsetDir, "subagents");

  try {
    await fs.access(subagentsDir);
  } catch {
    return [];
  }

  const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
  const inlineSubagents: Array<string> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const noriJsonPath = path.join(subagentsDir, entry.name, "nori.json");
    try {
      const content = await fs.readFile(noriJsonPath, "utf-8");
      const metadata = JSON.parse(content) as NoriJson;
      if (metadata.type === "inlined-subagent") {
        inlineSubagents.push(entry.name);
      }
    } catch {
      // No nori.json or invalid JSON — skip
    }
  }

  return inlineSubagents;
};

/**
 * Create nori.json files for inline/extract subagent candidates after resolution.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 * @param args.inlineCandidates - All subagent IDs that were candidates (no nori.json)
 * @param args.inlineSubagentIds - Subagent IDs that were chosen to be kept inline
 */
const createCandidateSubagentNoriJsonFiles = async (args: {
  skillsetDir: string;
  inlineCandidates: Array<string>;
  inlineSubagentIds: Array<string>;
}): Promise<void> => {
  const { skillsetDir, inlineCandidates, inlineSubagentIds } = args;
  const inlineSet = new Set(inlineSubagentIds);

  for (const candidate of inlineCandidates) {
    const subagentDir = path.join(skillsetDir, "subagents", candidate);
    const noriJsonPath = path.join(subagentDir, "nori.json");
    const type = inlineSet.has(candidate) ? "inlined-subagent" : "subagent";
    const metadata: NoriJson = {
      name: candidate,
      version: "1.0.0",
      type,
    };
    await fs.writeFile(noriJsonPath, JSON.stringify(metadata, null, 2));
  }
};

/**
 * Sync local state after a successful upload.
 *
 * Updates the local nori.json version and registryURL, writes a .nori-version
 * file, and updates extracted skill versions in their nori.json files and in
 * the skillset's dependencies.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The local skillset directory
 * @param args.uploadedVersion - The version that was uploaded
 * @param args.registryUrl - The registry URL
 * @param args.extractedSkills - Optional extracted skills info from the response
 * @param args.linkedSkillVersions - Optional map of linked skill IDs to their remote versions
 * @param args.extractedSubagents - Optional extracted subagents info from the response
 * @param args.linkedSubagentVersions - Optional map of linked subagent IDs to their remote versions
 */
const syncLocalStateAfterUpload = async (args: {
  skillsetDir: string;
  uploadedVersion: string;
  registryUrl: string;
  extractedSkills?: ExtractedSkillsSummary | null;
  extractedSubagents?: ExtractedSubagentsSummary | null;
  linkedSkillVersions?: Map<string, string> | null;
  linkedSubagentVersions?: Map<string, string> | null;
}): Promise<void> => {
  const {
    skillsetDir,
    uploadedVersion,
    registryUrl,
    extractedSkills,
    extractedSubagents,
    linkedSkillVersions,
    linkedSubagentVersions,
  } = args;

  // Update skillset nori.json version and registryURL
  let metadata: NoriJson;
  try {
    metadata = await readSkillsetMetadata({ skillsetDir });
  } catch (err) {
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      metadata = {
        name: path.basename(skillsetDir),
        version: uploadedVersion,
        type: "skillset",
      };
    } else {
      throw err;
    }
  }

  metadata.version = uploadedVersion;
  metadata.registryURL = registryUrl;

  // Update extracted skill versions in dependencies
  const succeeded = extractedSkills?.succeeded ?? [];
  if (succeeded.length > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.skills == null) {
      metadata.dependencies.skills = {};
    }

    for (const skill of succeeded) {
      metadata.dependencies.skills[skill.name] = skill.version;

      // Update individual skill nori.json
      const skillNoriJsonPath = path.join(
        skillsetDir,
        "skills",
        skill.name,
        "nori.json",
      );
      try {
        const content = await fs.readFile(skillNoriJsonPath, "utf-8");
        const skillMetadata = JSON.parse(content) as NoriJson;
        skillMetadata.version = skill.version;
        await fs.writeFile(
          skillNoriJsonPath,
          JSON.stringify(skillMetadata, null, 2),
        );
      } catch {
        // Skill nori.json may not exist (e.g., inlined skills)
      }
    }
  }

  // Update dependency versions for linked skills (kept existing remote version)
  if (linkedSkillVersions != null && linkedSkillVersions.size > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.skills == null) {
      metadata.dependencies.skills = {};
    }

    for (const [skillId, version] of linkedSkillVersions) {
      metadata.dependencies.skills[skillId] = version;
    }
  }

  // Update extracted subagent versions in dependencies
  const succeededSubagents = extractedSubagents?.succeeded ?? [];
  if (succeededSubagents.length > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.subagents == null) {
      metadata.dependencies.subagents = {};
    }

    for (const subagent of succeededSubagents) {
      metadata.dependencies.subagents[subagent.name] = subagent.version;

      // Update individual subagent nori.json
      const subagentNoriJsonPath = path.join(
        skillsetDir,
        "subagents",
        subagent.name,
        "nori.json",
      );
      try {
        const content = await fs.readFile(subagentNoriJsonPath, "utf-8");
        const subagentMetadata = JSON.parse(content) as NoriJson;
        subagentMetadata.version = subagent.version;
        await fs.writeFile(
          subagentNoriJsonPath,
          JSON.stringify(subagentMetadata, null, 2),
        );
      } catch {
        // Subagent nori.json may not exist (e.g., inlined subagents)
      }
    }
  }

  // Update dependency versions for linked subagents
  if (linkedSubagentVersions != null && linkedSubagentVersions.size > 0) {
    if (metadata.dependencies == null) {
      metadata.dependencies = {};
    }
    if (metadata.dependencies.subagents == null) {
      metadata.dependencies.subagents = {};
    }

    for (const [subagentId, version] of linkedSubagentVersions) {
      metadata.dependencies.subagents[subagentId] = version;
    }
  }

  await writeSkillsetMetadata({ skillsetDir, metadata });

  // Write .nori-version file
  await fs.writeFile(
    path.join(skillsetDir, ".nori-version"),
    JSON.stringify(
      {
        version: uploadedVersion,
        registryUrl,
      },
      null,
      2,
    ),
  );
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
}): Promise<CommandStatus> => {
  const {
    profileSpec,
    registryUrl,
    listVersions,
    nonInteractive,
    silent,
    dryRun,
    description,
  } = args;

  // Parse skillset spec using shared utility
  const parsed = parseNamespacedPackage({ packageSpec: profileSpec });
  if (parsed == null) {
    log.error(
      `Invalid skillset specification: "${profileSpec}".\nExpected format: skillset-name or org/skillset-name[@version]`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Invalid skillset specification: "${profileSpec}"`,
    };
  }

  const { orgId, packageName, version } = parsed;
  const profileDisplayName =
    orgId === "public" ? packageName : `${orgId}/${packageName}`;

  // Load config for auth and install dir resolution
  const config = await loadConfig();
  if (config == null) {
    log.error(`Could not load Nori configuration.`);
    return {
      success: false,
      cancelled: false,
      message: "Could not load Nori configuration",
    };
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
      return {
        success: false,
        cancelled: false,
        message: `No authentication configured for ${registryUrl}`,
      };
    }

    try {
      authToken = await getRegistryAuthToken({ registryAuth });
    } catch (err) {
      log.error(
        `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        success: false,
        cancelled: false,
        message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else if (orgId === "public" && hasUnifiedAuthWithOrgs) {
    // Public registry is open to any authenticated user
    targetRegistryUrl = buildOrganizationRegistryUrl({ orgId });

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
      return {
        success: false,
        cancelled: false,
        message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else if (orgId === "public") {
    // Public registry requires auth for uploads
    log.error(
      `Authentication required to upload to public registry.\n\nLog in with 'nori-skillsets login' to configure registry access.`,
    );
    return {
      success: false,
      cancelled: false,
      message: "Authentication required to upload to public registry",
    };
  } else if (hasUnifiedAuthWithOrgs) {
    // Org-scoped upload requires org membership
    targetRegistryUrl = buildOrganizationRegistryUrl({ orgId });
    const userOrgs = config.auth!.organizations!;

    if (!userOrgs.includes(orgId)) {
      log.error(
        `You do not have access to organization "${orgId}".\n\nCannot upload "${profileDisplayName}" to ${targetRegistryUrl}.\n\nYour available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
      );
      return {
        success: false,
        cancelled: false,
        message: `You do not have access to organization "${orgId}"`,
      };
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
      return {
        success: false,
        cancelled: false,
        message: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    // No auth configured - login required
    log.error(
      `Cannot upload "${profileDisplayName}". To upload to organization "${orgId}", log in with:\n\n  nori-skillsets login`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Cannot upload "${profileDisplayName}". Login required`,
    };
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

    if (result == null) {
      return { success: false, cancelled: true, message: "" };
    }
    return {
      success: true,
      cancelled: false,
      message: result.statusMessage,
    };
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
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${profileDisplayName}" not found at: ${skillsetDir}`,
    };
  }

  // Helper to sync local state after upload, swallowing errors
  const trySyncLocalState = async (syncArgs: {
    uploadedVersion: string;
    extractedSkills?: ExtractedSkillsSummary | null;
    extractedSubagents?: ExtractedSubagentsSummary | null;
    linkedSkillVersions?: Map<string, string> | null;
    linkedSubagentVersions?: Map<string, string> | null;
  }): Promise<void> => {
    try {
      await syncLocalStateAfterUpload({
        skillsetDir,
        registryUrl: targetRegistryUrl,
        ...syncArgs,
      });
    } catch (syncErr) {
      log.warn(
        `Upload succeeded but failed to sync local state: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
      );
    }
  };

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
    return {
      success: true,
      cancelled: false,
      message: `[Dry run] Would upload "${profileDisplayName}@${versionResult.version}" to ${targetRegistryUrl}`,
    };
  }

  // Backfill type field on existing nori.json files before upload
  await backfillNoriJsonTypes({ skillsetDir });

  // Detect inline skill candidates (skills without nori.json)
  const inlineCandidates = await detectInlineSkillCandidates({ skillsetDir });

  // Detect skills already marked as inlined from a previous upload
  const existingInlineSkills = await detectExistingInlineSkills({
    skillsetDir,
  });

  // Detect inline subagent candidates (directory-based subagents without nori.json)
  const subagentInlineCandidates = await detectInlineSubagentCandidates({
    skillsetDir,
  });

  // Detect subagents already marked as inlined from a previous upload
  const existingInlineSubagents = await detectExistingInlineSubagents({
    skillsetDir,
  });

  // Helper to perform upload with optional resolution strategy
  const performUpload = async (uploadArgs: {
    resolutionStrategy?: SkillResolutionStrategy | null;
    subagentResolutionStrategy?: SubagentResolutionStrategy | null;
    inlineSkills?: Array<string> | null;
    inlineSubagents?: Array<string> | null;
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

      // Create nori.json for subagent inline/extract candidates
      if (subagentInlineCandidates.length > 0) {
        await createCandidateSubagentNoriJsonFiles({
          skillsetDir,
          inlineCandidates: subagentInlineCandidates,
          inlineSubagentIds: uploadArgs.inlineSubagents ?? [],
        });
      }

      const tarballBuffer = await createProfileTarball({ skillsetDir });
      const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
      new Uint8Array(archiveData).set(tarballBuffer);

      // Merge existing inlined skills with newly-resolved inline candidates
      const allInlineSkills = [
        ...existingInlineSkills,
        ...(uploadArgs.inlineSkills ?? []),
      ];

      // Merge existing inlined subagents with newly-resolved inline candidates
      const allInlineSubagents = [
        ...existingInlineSubagents,
        ...(uploadArgs.inlineSubagents ?? []),
      ];

      const result: UploadSkillsetResponse = await registrarApi.uploadSkillset({
        packageName,
        version: uploadArgs.uploadVersion,
        archiveData,
        authToken,
        registryUrl: targetRegistryUrl,
        description: description ?? undefined,
        resolutionStrategy: uploadArgs.resolutionStrategy ?? undefined,
        subagentResolutionStrategy:
          uploadArgs.subagentResolutionStrategy ?? undefined,
        inlineSkills: allInlineSkills.length > 0 ? allInlineSkills : undefined,
        inlineSubagents:
          allInlineSubagents.length > 0 ? allInlineSubagents : undefined,
      });

      return {
        success: true,
        version: result.version,
        extractedSkills: result.extractedSkills,
        extractedSubagents: result.extractedSubagents,
      };
    } catch (err) {
      if (isSkillCollisionError(err)) {
        return {
          success: false,
          conflicts: err.conflicts,
        };
      }

      if (isSubagentCollisionError(err)) {
        // SubagentCollisionError stores conflicts in `conflicts` property,
        // but also check `subagentConflicts` for raw error objects from the API
        const rawConflicts =
          err.conflicts ??
          (err as unknown as { subagentConflicts?: Array<SubagentConflict> })
            .subagentConflicts ??
          [];
        return {
          success: false,
          subagentConflicts: rawConflicts as Array<SubagentConflict>,
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

    if (uploadResult.success) {
      await trySyncLocalState({
        uploadedVersion: uploadResult.version,
        extractedSkills: uploadResult.extractedSkills,
      });

      return {
        success: true,
        cancelled: false,
        message: `Uploaded "${bold({ text: `${profileDisplayName}@${versionResult.version}` })}"`,
      };
    }

    const errorMessage =
      "error" in uploadResult ? uploadResult.error : "Upload failed";
    return {
      success: false,
      cancelled: false,
      message: errorMessage,
    };
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
    inlineSubagentCandidates:
      subagentInlineCandidates.length > 0
        ? subagentInlineCandidates
        : undefined,
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
          subagentResolutionStrategy:
            uploadCallbackArgs.subagentResolutionStrategy,
          inlineSkills: uploadCallbackArgs.inlineSkillIds,
          inlineSubagents: uploadCallbackArgs.inlineSubagentIds,
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
      onReadLocalSubagentMd: async ({ subagentId }) => {
        const subagentMdPath = path.join(
          skillsetDir,
          "subagents",
          subagentId,
          "SUBAGENT.md",
        );
        try {
          return await fs.readFile(subagentMdPath, "utf-8");
        } catch {
          return null;
        }
      },
    },
  });

  if (result == null) {
    return { success: false, cancelled: true, message: "" };
  }

  await trySyncLocalState({
    uploadedVersion: result.version,
    extractedSkills: result.extractedSkills,
    extractedSubagents: result.extractedSubagents,
    linkedSkillVersions: result.linkedSkillVersions,
    linkedSubagentVersions: result.linkedSubagentVersions,
  });

  return {
    success: true,
    cancelled: false,
    message: result.statusMessage,
  };
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
