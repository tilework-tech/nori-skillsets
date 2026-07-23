/**
 * CLI command for uploading skillset packages to the Nori registry
 * Handles: nori-skillsets upload <skillset>[@version] [--registry <url>] [--list-versions]
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";

import {
  hasRegistryAuthCredentials,
  toRegistryAuth,
} from "@/api/authCredentials.js";
import { readApiTokenEnv } from "@/api/base.js";
import {
  registrarApi,
  type SkillResolutionStrategy,
  type SubagentResolutionStrategy,
  type ExtractedSkillsSummary,
  type ExtractedSubagentsSummary,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { guardPublicUpload } from "@/cli/commands/publicUploadGuard.js";
import { getRegistryAuth, loadConfig } from "@/cli/config.js";
import { isGitGovernedPath } from "@/cli/features/gitSourceAuthority.js";
import { bold } from "@/cli/logger.js";
import { uploadFlow, listVersionsFlow } from "@/cli/prompts/flows/index.js";
import { resolveOrgRegistryAuth } from "@/core/registryAuthResolution.js";
import {
  performSkillsetUpload,
  persistFlatSubagentInlineChoices,
} from "@/core/uploadPipeline.js";
import {
  determineUploadVersion,
  parseResolveStrategy,
  type UploadResult,
} from "@/core/uploadPolicy.js";
import { syncLocalStateAfterUpload } from "@/core/uploadSync.js";
import { readSkillsetMetadata } from "@/norijson/nori.js";
import { resolveSkillsetDir } from "@/norijson/skillset.js";
import { isDirentDirectory } from "@/utils/dirent.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
  extractOrgId,
  namespacedName,
  formatDefaultOrgNotice,
} from "@/utils/url.js";

import type { RegistryAuth } from "@/api/authCredentials.js";
import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { NoriJson } from "@/norijson/nori.js";

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
    if (!(await isDirentDirectory({ parentDir: skillsDir, entry }))) continue;

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
    if (!(await isDirentDirectory({ parentDir: skillsDir, entry }))) continue;

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
      if (!(await isDirentDirectory({ parentDir: skillsDir, entry }))) continue;
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
      if (!(await isDirentDirectory({ parentDir: subagentsDir, entry })))
        continue;
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
 * Migrate legacy CLAUDE.md to AGENTS.md in a skillset directory.
 * Renames CLAUDE.md → AGENTS.md if CLAUDE.md exists and AGENTS.md does not.
 * Does nothing if AGENTS.md already exists or neither file exists.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory
 */
const migrateConfigToAgentsMd = async (args: {
  skillsetDir: string;
}): Promise<void> => {
  const { skillsetDir } = args;
  const agentsPath = path.join(skillsetDir, "AGENTS.md");
  const claudePath = path.join(skillsetDir, "CLAUDE.md");

  try {
    await fs.access(agentsPath);
    return; // AGENTS.md already exists, nothing to do
  } catch {
    // AGENTS.md doesn't exist, check for CLAUDE.md
  }

  try {
    await fs.access(claudePath);
    await fs.rename(claudePath, agentsPath);
  } catch {
    // Neither file exists, nothing to do
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
    if (!(await isDirentDirectory({ parentDir: subagentsDir, entry })))
      continue;

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
    if (!(await isDirentDirectory({ parentDir: subagentsDir, entry })))
      continue;

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
 * Detect flat .md subagent files that are already recorded in the skillset's
 * nori.json subagents array. These were previously decided to be inline and
 * should be included in the upload without re-prompting.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory to scan
 *
 * @returns Array of subagent IDs that are already declared as inline flat subagents
 */
const detectExistingFlatInlineSubagents = async (args: {
  skillsetDir: string;
}): Promise<Array<string>> => {
  const { skillsetDir } = args;

  let declaredIds: Set<string>;
  try {
    const metadata = await readSkillsetMetadata({ skillsetDir });
    declaredIds = new Set((metadata.subagents ?? []).map((s) => s.id));
  } catch {
    return [];
  }

  const subagentsDir = path.join(skillsetDir, "subagents");
  try {
    const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
    const results: Array<string> = [];
    for (const e of entries) {
      if (await isDirentDirectory({ parentDir: subagentsDir, entry: e }))
        continue;
      if (!e.name.endsWith(".md") || e.name === "docs.md") continue;
      const id = e.name.slice(0, -".md".length);
      if (declaredIds.has(id)) results.push(id);
    }
    return results;
  } catch {
    return [];
  }
};

/**
 * Detect flat .md subagent files that are not yet recorded in the skillset's
 * nori.json subagents array. These are candidates for the inline/extract prompt.
 *
 * Flat files are .md files directly in subagents/ (not in subdirectories).
 * Excludes docs.md and files that have a corresponding directory-based subagent.
 *
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory to scan
 *
 * @returns Array of subagent IDs (filename without .md) that need a decision
 */
const detectFlatSubagentCandidates = async (args: {
  skillsetDir: string;
}): Promise<Array<string>> => {
  const { skillsetDir } = args;
  const subagentsDir = path.join(skillsetDir, "subagents");

  try {
    await fs.access(subagentsDir);
  } catch {
    return [];
  }

  // Read the skillset's nori.json to check which flat subagents are already declared
  let declaredSubagentIds: Set<string>;
  try {
    const metadata = await readSkillsetMetadata({ skillsetDir });
    declaredSubagentIds = new Set((metadata.subagents ?? []).map((s) => s.id));
  } catch {
    declaredSubagentIds = new Set();
  }

  const entries = await fs.readdir(subagentsDir, { withFileTypes: true });

  // Collect directory-based subagent names to skip flat files that collide
  const dirSubagentNames = new Set<string>();
  for (const entry of entries) {
    if (!(await isDirentDirectory({ parentDir: subagentsDir, entry })))
      continue;
    const subagentMdPath = path.join(subagentsDir, entry.name, "SUBAGENT.md");
    try {
      await fs.access(subagentMdPath);
      dirSubagentNames.add(entry.name);
    } catch {
      // Not a subagent directory
    }
  }

  const candidates: Array<string> = [];

  for (const entry of entries) {
    if (await isDirentDirectory({ parentDir: subagentsDir, entry })) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "docs.md") continue;

    const id = entry.name.slice(0, -".md".length);

    // Skip if a directory-based subagent with the same name exists
    if (dirSubagentNames.has(id)) continue;

    // Skip if already declared in nori.json subagents array
    if (declaredSubagentIds.has(id)) continue;

    candidates.push(id);
  }

  return candidates;
};

/**
 * Main upload function
 * @param args - The function arguments
 * @param args.profileSpec - Skillset specification (name[@version] or org/name[@version])
 * @param args.cwd - Current working directory
 * @param args.installDir - Custom installation directory
 * @param args.registryUrl - Target registry URL
 * @param args.publicRegistry - Explicit opt-in to publish to the public registry
 * @param args.listVersions - If true, list versions instead of uploading
 * @param args.nonInteractive - Run without prompts
 * @param args.silent - Suppress output
 * @param args.dryRun - Show what would happen without uploading
 * @param args.description - Description for the skillset version
 * @param args.resolve - Resolution strategy to apply to unresolved skill conflicts in non-interactive mode
 *
 * @returns Upload result
 */
export const registryUploadMain = async (args: {
  profileSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  publicRegistry?: boolean | null;
  listVersions?: boolean | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
  dryRun?: boolean | null;
  description?: string | null;
  resolve?: string | null;
}): Promise<CommandStatus> => {
  const {
    profileSpec,
    registryUrl,
    publicRegistry,
    listVersions,
    nonInteractive,
    silent,
    dryRun,
    description,
    resolve,
  } = args;

  // Load config first so a bare name can resolve against the configured default
  // org. An explicit --public or --registry target overrides that resolution.
  const config = await loadConfig();

  // Parse skillset spec using shared utility
  const parsed = parseNamespacedPackage({
    packageSpec: profileSpec,
    defaultOrg:
      publicRegistry === true || registryUrl != null
        ? null
        : config?.defaultOrg,
  });
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
  const profileDisplayName = namespacedName({ orgId, packageName });

  const defaultOrgNotice = formatDefaultOrgNotice({
    packageSpec: profileSpec,
    orgId,
    packageName,
  });
  if (defaultOrgNotice != null && silent !== true) {
    log.info(defaultOrgNotice);
  }

  const parsedResolve = parseResolveStrategy({ resolve });

  if ("error" in parsedResolve) {
    log.error(parsedResolve.error);
    return {
      success: false,
      cancelled: false,
      message: `Invalid --resolve value: "${resolve}"`,
    };
  }

  const resolveAction = parsedResolve.action;

  // Require an explicit target before publishing to the public registry.
  // Read-only operations (--list-versions, --dry-run) never publish, so they
  // are exempt.
  if (!listVersions && !dryRun) {
    const publicGuard = await guardPublicUpload({
      kind: "skillset",
      packageSpec: profileSpec,
      orgId,
      displayName: packageName,
      registryUrl,
      publicRegistry,
      nonInteractive,
      silent,
    });
    if (!publicGuard.ok) {
      if (publicGuard.message !== "") {
        log.error(publicGuard.message);
      }
      return {
        success: false,
        cancelled: publicGuard.cancelled,
        message: publicGuard.message,
      };
    }
  }

  // Auth and install dir are resolved from the config loaded above.
  const envApi = readApiTokenEnv();
  if (config == null && envApi == null) {
    log.error(`Could not load Nori configuration.`);
    return {
      success: false,
      cancelled: false,
      message: "Could not load Nori configuration",
    };
  }

  const hasMatchingEnvToken = (url: string): boolean => {
    const targetOrgId = extractOrgId({ url });
    return (
      envApi != null && targetOrgId != null && envApi.orgId === targetOrgId
    );
  };

  const envRegistryAuth = (url: string): RegistryAuth | null => {
    if (!hasMatchingEnvToken(url)) {
      return null;
    }
    return {
      registryUrl: url,
      username: null,
    };
  };

  // Check for unified auth with organizations (new flow)
  const hasUnifiedAuthWithOrgs =
    config?.auth != null &&
    hasRegistryAuthCredentials({ auth: config.auth }) &&
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
      const userOrgs = config!.auth!.organizations!;
      for (const userOrgId of userOrgs) {
        const orgRegistryUrl = buildOrganizationRegistryUrl({
          orgId: userOrgId,
        });
        if (orgRegistryUrl === registryUrl) {
          registryAuth = toRegistryAuth({
            auth: config!.auth!,
            registryUrl,
          });
          break;
        }
      }
    }

    // Fall back to config-level registry auth
    if (registryAuth == null && config != null) {
      registryAuth = getRegistryAuth({ config, registryUrl });
    }
    registryAuth ??= envRegistryAuth(registryUrl);

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
  } else if (
    orgId === "public" &&
    (hasUnifiedAuthWithOrgs ||
      hasMatchingEnvToken(buildOrganizationRegistryUrl({ orgId })))
  ) {
    // Public registry is open to any authenticated user
    targetRegistryUrl = buildOrganizationRegistryUrl({ orgId });

    const registryAuth: RegistryAuth =
      config?.auth != null
        ? toRegistryAuth({
            auth: config.auth,
            registryUrl: targetRegistryUrl,
          })
        : {
            registryUrl: targetRegistryUrl,
            username: null,
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
  } else if (
    hasUnifiedAuthWithOrgs ||
    hasMatchingEnvToken(buildOrganizationRegistryUrl({ orgId }))
  ) {
    // Org-scoped upload requires org membership (a matching env token bypasses)
    const resolution = resolveOrgRegistryAuth({
      auth: config?.auth ?? null,
      orgId,
    });
    targetRegistryUrl = resolution.registryUrl;

    if (resolution.ok === false && !hasMatchingEnvToken(targetRegistryUrl)) {
      const userOrgs =
        resolution.reason === "not-a-member" ? resolution.organizations : [];
      log.error(
        `You do not have access to organization "${orgId}".\n\nCannot upload "${profileDisplayName}" to ${targetRegistryUrl}.\n\nYour available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
      );
      return {
        success: false,
        cancelled: false,
        message: `You do not have access to organization "${orgId}"`,
      };
    }

    const registryAuth: RegistryAuth = resolution.ok
      ? resolution.registryAuth
      : config?.auth != null
        ? toRegistryAuth({
            auth: config.auth,
            registryUrl: targetRegistryUrl,
          })
        : {
            registryUrl: targetRegistryUrl,
            username: null,
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

  // Find the local skillset to publish. The source may live in any bucket
  // (personal/, public/) or the legacy flat location, so a public package is
  // located by its bare name (bucket precedence applies) while an org package is
  // located at its namespace. This resolves the source only; the registry target
  // is derived separately from the parsed namespace.
  const skillsetDir = await resolveSkillsetDir({
    name:
      orgId === "public" ? packageName : namespacedName({ orgId, packageName }),
  });

  if (skillsetDir == null) {
    log.error(`Skillset "${profileDisplayName}" not found`);
    return {
      success: false,
      cancelled: false,
      message: `Skillset "${profileDisplayName}" not found`,
    };
  }

  if (dryRun !== true) {
    try {
      if (await isGitGovernedPath({ targetPath: skillsetDir })) {
        const message = `Git-governed skillset detected at "${skillsetDir}"; Registrar upload refused. Publish this source through Git instead.`;
        log.error(message);
        return { success: false, cancelled: false, message };
      }
    } catch (error) {
      const message = `Failed to inspect skillset source at "${skillsetDir}": ${error instanceof Error ? error.message : String(error)}`;
      log.error(message);
      return { success: false, cancelled: false, message };
    }
  }

  // Helper to sync local state after upload, surfacing non-fatal warnings
  // and swallowing errors (a sync failure must not mask a successful upload)
  const trySyncLocalState = async (syncArgs: {
    uploadedVersion: string;
    extractedSkills?: ExtractedSkillsSummary | null;
    extractedSubagents?: ExtractedSubagentsSummary | null;
    linkedSkillVersions?: Map<string, string> | null;
    linkedSubagentVersions?: Map<string, string> | null;
    linkedSkillsToReplace?: Map<string, string> | null;
    linkedSubagentsToReplace?: Map<string, string> | null;
  }): Promise<void> => {
    try {
      const { warnings } = await syncLocalStateAfterUpload({
        skillsetDir,
        registryUrl: targetRegistryUrl,
        ...syncArgs,
      });
      for (const warning of warnings) {
        log.warn(warning);
      }
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

  // Migrate legacy CLAUDE.md → AGENTS.md
  await migrateConfigToAgentsMd({ skillsetDir });

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

  // Detect flat .md subagent candidates not yet recorded in nori.json.subagents
  const flatSubagentCandidates = await detectFlatSubagentCandidates({
    skillsetDir,
  });

  // In non-interactive mode, auto-inline flat subagents (persist decision silently)
  if (flatSubagentCandidates.length > 0 && nonInteractive) {
    await persistFlatSubagentInlineChoices({
      skillsetDir,
      flatSubagentIds: flatSubagentCandidates,
    });
  }

  // Detect flat subagents already declared in nori.json.subagents (existing inline)
  const existingFlatInlineSubagents = await detectExistingFlatInlineSubagents({
    skillsetDir,
  });

  // Detect subagents already marked as inlined from a previous upload
  const existingInlineSubagents = await detectExistingInlineSubagents({
    skillsetDir,
  });

  // Merge flat candidates into the subagent inline candidates for prompting
  // (only undecided ones — non-interactive flat candidates were already handled above)
  const flatCandidatesForPrompt = nonInteractive ? [] : flatSubagentCandidates;
  const allSubagentInlineCandidates = [
    ...subagentInlineCandidates,
    ...flatCandidatesForPrompt,
  ];
  // Bind the command's packaging context onto the core upload pipeline so the
  // silent path and the interactive flow callback drive the same function
  const performUpload = async (uploadArgs: {
    resolutionStrategy?: SkillResolutionStrategy | null;
    subagentResolutionStrategy?: SubagentResolutionStrategy | null;
    inlineSkills?: Array<string> | null;
    inlineSubagents?: Array<string> | null;
    uploadVersion: string;
  }): Promise<UploadResult> => {
    return performSkillsetUpload({
      skillsetDir,
      packageName,
      registryUrl: targetRegistryUrl,
      authToken,
      description,
      inlineCandidates,
      subagentInlineCandidates,
      flatSubagentCandidates: flatCandidatesForPrompt,
      existingInlineSkills,
      existingInlineSubagents,
      existingFlatInlineSubagents,
      ...uploadArgs,
    });
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
    resolve: resolveAction,
    inlineCandidates:
      inlineCandidates.length > 0 ? inlineCandidates : undefined,
    inlineSubagentCandidates:
      allSubagentInlineCandidates.length > 0
        ? allSubagentInlineCandidates
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
        // Try directory-based first, then fall back to flat file
        const subagentMdPath = path.join(
          skillsetDir,
          "subagents",
          subagentId,
          "SUBAGENT.md",
        );
        try {
          return await fs.readFile(subagentMdPath, "utf-8");
        } catch {
          const flatPath = path.join(
            skillsetDir,
            "subagents",
            `${subagentId}.md`,
          );
          try {
            return await fs.readFile(flatPath, "utf-8");
          } catch {
            return null;
          }
        }
      },
    },
  });

  if (result == null) {
    return {
      success: false,
      cancelled: !(nonInteractive ?? false),
      message: nonInteractive ? "Upload failed" : "",
    };
  }

  await trySyncLocalState({
    uploadedVersion: result.version,
    extractedSkills: result.extractedSkills,
    extractedSubagents: result.extractedSubagents,
    linkedSkillVersions: result.linkedSkillVersions,
    linkedSubagentVersions: result.linkedSubagentVersions,
    linkedSkillsToReplace: result.linkedSkillsToReplace,
    linkedSubagentsToReplace: result.linkedSubagentsToReplace,
  });

  return {
    success: true,
    cancelled: false,
    message: result.statusMessage,
  };
};
