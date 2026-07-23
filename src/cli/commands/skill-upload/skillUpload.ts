/**
 * CLI command for uploading a single skill package to the Nori registrar.
 * Handles: nori-skillsets upload-skill <skill>[@<version>] [--skillset <name>] [--registry <url>] [--description <text>]
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import * as semver from "semver";

import {
  hasRegistryAuthCredentials,
  toRegistryAuth,
  type RegistryAuth,
} from "@/api/authCredentials.js";
import { readApiTokenEnv } from "@/api/base.js";
import {
  registrarApi,
  REGISTRAR_URL,
  type Packument,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { type CliName } from "@/cli/commands/cliCommandNames.js";
import { guardPublicUpload } from "@/cli/commands/publicUploadGuard.js";
import {
  loadConfig,
  getActiveSkillset,
  getRegistryAuth,
  type Config,
} from "@/cli/config.js";
import { skillUploadFlow } from "@/cli/prompts/flows/index.js";
import { resolveUserSkillsetRef } from "@/cli/skillsetResolution.js";
import { resolveOrgRegistryAuth } from "@/core/registryAuthResolution.js";
import { createArchive, extractFileFromArchive } from "@/packaging/archive.js";
import {
  parseNamespacedPackage,
  extractOrgId,
  formatDefaultOrgNotice,
  namespacedName,
} from "@/utils/url.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { CheckExistingResult } from "@/cli/prompts/flows/skillUpload.js";
import type { NoriJson } from "@/norijson/nori.js";

/**
 * Read the skill's local nori.json, or null if missing/invalid.
 *
 * @param args - Arguments
 * @param args.skillDir - Absolute path to the skill directory
 *
 * @returns Parsed nori.json, or null if the file is missing or not valid JSON
 */
const readSkillNoriJson = async (args: {
  skillDir: string;
}): Promise<NoriJson | null> => {
  const { skillDir } = args;
  try {
    const content = await fs.readFile(
      path.join(skillDir, "nori.json"),
      "utf-8",
    );
    return JSON.parse(content) as NoriJson;
  } catch {
    return null;
  }
};

/**
 * Write the updated version back to the skill's local nori.json.
 *
 * @param args - Arguments
 * @param args.skillDir - Absolute path to the skill directory
 * @param args.version - New version to persist
 */
const writeSkillVersion = async (args: {
  skillDir: string;
  version: string;
}): Promise<void> => {
  const { skillDir, version } = args;
  const noriJsonPath = path.join(skillDir, "nori.json");
  let metadata: NoriJson;
  try {
    metadata = JSON.parse(await fs.readFile(noriJsonPath, "utf-8")) as NoriJson;
  } catch {
    return;
  }
  metadata.version = version;
  await fs.writeFile(noriJsonPath, JSON.stringify(metadata, null, 2));
};

/**
 * Determine the registry URL and auth token to use for the upload.
 *
 * @param args - Arguments
 * @param args.orgId - Parsed org namespace (or "public")
 * @param args.registryUrl - Optional explicit --registry URL
 * @param args.config - Loaded Nori config, or null if none
 * @param args.skillDisplayName - Skill display name for error messages
 *
 * @returns Resolved target URL + auth token, or an error object
 */
const resolveRegistryAndAuth = async (args: {
  orgId: string;
  registryUrl?: string | null;
  config: Config | null;
  skillDisplayName: string;
}): Promise<
  | { ok: true; registryUrl: string; authToken: string }
  | { ok: false; error: string; hint?: string | null }
> => {
  const { orgId, registryUrl, config, skillDisplayName } = args;

  if (orgId !== "public" && registryUrl != null) {
    return {
      ok: false,
      error: `Cannot specify both namespace and --registry flag.\n\nThe namespace "${orgId}/" determines the registry automatically.`,
    };
  }

  const orgResolution =
    orgId !== "public"
      ? resolveOrgRegistryAuth({ auth: config?.auth ?? null, orgId })
      : null;

  // Determine target URL from CLI flag, org namespace, or default
  const targetRegistryUrl =
    registryUrl != null
      ? registryUrl
      : orgResolution != null
        ? orgResolution.registryUrl
        : REGISTRAR_URL;
  const envApi = readApiTokenEnv();
  const targetOrgId = extractOrgId({ url: targetRegistryUrl });
  const hasMatchingEnvToken =
    envApi != null && targetOrgId != null && envApi.orgId === targetOrgId;

  // Org-scoped upload: verify membership when we have a known org list
  // (a matching env token bypasses the check)
  if (
    orgResolution?.ok === false &&
    orgResolution.reason === "not-a-member" &&
    !hasMatchingEnvToken
  ) {
    return {
      ok: false,
      error: `You do not have access to organization "${orgId}".`,
      hint: `Your available organizations: ${orgResolution.organizations.length > 0 ? orgResolution.organizations.join(", ") : "(none)"}`,
    };
  }

  // Public registry with unified auth — use the unified token directly,
  // matching the explicit branch in registryUpload.ts.
  let registryAuth: RegistryAuth | null = null;
  if (
    orgId === "public" &&
    registryUrl == null &&
    (hasMatchingEnvToken ||
      hasRegistryAuthCredentials({ auth: config?.auth ?? null }))
  ) {
    registryAuth =
      config?.auth != null
        ? toRegistryAuth({
            auth: config.auth,
            registryUrl: REGISTRAR_URL,
          })
        : {
            registryUrl: REGISTRAR_URL,
            username: null,
          };
  }

  // Otherwise prefer per-registry auth
  if (registryAuth == null && config != null) {
    registryAuth = getRegistryAuth({ config, registryUrl: targetRegistryUrl });
  }

  // Fall back to unified auth from config.auth (for org-scoped and
  // explicit --registry paths when no matching entry was found)
  if (
    registryAuth == null &&
    (hasMatchingEnvToken ||
      hasRegistryAuthCredentials({ auth: config?.auth ?? null }))
  ) {
    registryAuth =
      config?.auth != null
        ? toRegistryAuth({
            auth: config.auth,
            registryUrl: targetRegistryUrl,
          })
        : {
            registryUrl: targetRegistryUrl,
            username: null,
          };
  }

  if (registryAuth == null) {
    return {
      ok: false,
      error: `Cannot upload "${skillDisplayName}" without authentication.`,
      hint: "Log in with: nori-skillsets login",
    };
  }

  const authToken = await getRegistryAuthToken({ registryAuth });
  return { ok: true, registryUrl: targetRegistryUrl, authToken };
};

/**
 * Upload a single skill from ~/.nori/profiles/<skillset>/skills/<skillName>
 * to the Nori registry.
 *
 * @param args - Arguments
 * @param args.skillSpec - Skill name, optionally namespaced (e.g., "my-skill" or "org/my-skill") and/or versioned (e.g., "my-skill@1.0.0")
 * @param args.skillset - Source skillset name (defaults to the active skillset)
 * @param args.registryUrl - Explicit registry URL (mutually exclusive with namespace)
 * @param args.publicRegistry - Explicit opt-in to publish to the public registry
 * @param args.version - Explicit version to publish (bypasses collision prompts)
 * @param args.description - Description for this version (defaults to the local nori.json.description)
 * @param args.cliName - CLI name used in user-facing messages
 * @param args.nonInteractive - If true, skip interactive prompts
 * @param args.silent - If true, suppress output
 *
 * @returns Command status
 */
export const skillUploadMain = async (args: {
  skillSpec: string;
  skillset?: string | null;
  registryUrl?: string | null;
  publicRegistry?: boolean | null;
  version?: string | null;
  description?: string | null;
  cliName?: CliName | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
}): Promise<CommandStatus> => {
  const {
    skillSpec,
    skillset,
    registryUrl,
    publicRegistry,
    version: explicitVersion,
    description: cliDescription,
    nonInteractive,
    silent,
  } = args;

  // Load config first so a bare name can resolve against the configured default
  // org. An explicit --public or --registry target overrides that resolution.
  const config = await loadConfig();

  // Parse the skill spec (supports "name", "org/name", "name@version")
  const parsed = parseNamespacedPackage({
    packageSpec: skillSpec,
    defaultOrg:
      publicRegistry === true || registryUrl != null
        ? null
        : config?.defaultOrg,
  });
  if (parsed == null) {
    log.error(
      `Invalid skill specification: "${skillSpec}".\nExpected format: skill-name or org/skill-name`,
    );
    return {
      success: false,
      cancelled: false,
      message: "Invalid skill specification",
    };
  }
  const { orgId, packageName: skillName, version: specVersion } = parsed;
  const skillDisplayName = namespacedName({ orgId, packageName: skillName });

  const defaultOrgNotice = formatDefaultOrgNotice({
    packageSpec: skillSpec,
    orgId,
    packageName: skillName,
  });
  if (defaultOrgNotice != null && silent !== true) {
    log.info(defaultOrgNotice);
  }

  const effectiveVersion = explicitVersion ?? specVersion ?? null;

  // Resolve source skillset
  const sourceSkillsetRef = await resolveUserSkillsetRef({
    name: skillset,
    activeSkillset: config != null ? getActiveSkillset({ config }) : null,
    defaultOrg: config?.defaultOrg,
    nameWasProvided: skillset != null,
    warn: !nonInteractive,
  });
  if (sourceSkillsetRef == null) {
    log.error(
      "No active skillset set. Pass --skillset <name> or activate a skillset with `nori-skillsets switch <name>`.",
    );
    return {
      success: false,
      cancelled: false,
      message: "No active skillset",
    };
  }
  const sourceSkillset = sourceSkillsetRef.identity;

  const sourceSkillsetDir = sourceSkillsetRef.dir;
  const skillDir = path.join(sourceSkillsetDir, "skills", skillName);

  try {
    await fs.access(skillDir);
  } catch {
    log.error(
      `Skill "${skillName}" not found in skillset "${sourceSkillset}" at:\n${skillDir}`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Skill "${skillName}" not found`,
    };
  }

  // Block uploading inlined skills
  const localNoriJson = await readSkillNoriJson({ skillDir });
  if (localNoriJson?.type === "inlined-skill") {
    log.error(
      `"${skillName}" is marked as type "inlined-skill". Inlined skills are bundled with their parent skillset and cannot be uploaded independently.`,
    );
    return {
      success: false,
      cancelled: false,
      message: `"${skillName}" is an inlined skill and cannot be uploaded independently`,
    };
  }

  // Require an explicit target before publishing to the public registry
  const publicGuard = await guardPublicUpload({
    kind: "skill",
    packageSpec: skillSpec,
    orgId,
    displayName: skillName,
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

  // Resolve registry URL + auth token
  const authResolution = await resolveRegistryAndAuth({
    orgId,
    registryUrl,
    config,
    skillDisplayName,
  });
  if (!authResolution.ok) {
    log.error(authResolution.error);
    if (authResolution.hint != null) {
      log.info(authResolution.hint);
    }
    return {
      success: false,
      cancelled: false,
      message: authResolution.error,
    };
  }
  const { registryUrl: targetRegistryUrl, authToken } = authResolution;

  // Compute the description fallback from nori.json
  const effectiveDescription =
    cliDescription ?? localNoriJson?.description ?? null;

  // Read local SKILL.md content (we will need it for diff if collision)
  let localSkillMd: string;
  try {
    localSkillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8");
  } catch {
    log.error(`SKILL.md not found in: ${skillDir}`);
    return {
      success: false,
      cancelled: false,
      message: "SKILL.md not found",
    };
  }

  // Drive the upload flow
  let uploadFailureMessage: string | null = null;
  const result = await skillUploadFlow({
    skillDisplayName,
    defaultVersion: localNoriJson?.version ?? "1.0.0",
    explicitVersion: effectiveVersion,
    nonInteractive,
    callbacks: {
      onCheckExisting: async (): Promise<CheckExistingResult> => {
        let packument: Packument;
        try {
          packument = await registrarApi.getSkillPackument({
            skillName,
            registryUrl: targetRegistryUrl,
            authToken: authToken ?? undefined,
          });
        } catch {
          return { exists: false };
        }

        const latestVersion = packument["dist-tags"].latest;
        if (latestVersion == null) {
          return { exists: false };
        }

        const tarballData = await registrarApi.downloadSkillTarball({
          skillName,
          version: latestVersion,
          registryUrl: targetRegistryUrl,
          authToken: authToken ?? undefined,
        });

        const remoteSkillMd =
          (await extractFileFromArchive({
            tarballData,
            fileName: "SKILL.md",
          })) ?? "";

        return {
          exists: true,
          latestVersion,
          remoteSkillMd,
          localSkillMd,
          contentUnchanged: remoteSkillMd === localSkillMd,
        };
      },
      onUpload: async ({ version }) => {
        if (semver.valid(version) == null) {
          uploadFailureMessage = `Invalid version: "${version}"`;
          return {
            success: false,
            error: uploadFailureMessage,
          };
        }
        try {
          const tarballBuffer = await createArchive({ sourceDir: skillDir });
          const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
          new Uint8Array(archiveData).set(tarballBuffer);

          await registrarApi.uploadSkill({
            skillName,
            version,
            archiveData,
            description: effectiveDescription,
            authToken,
            registryUrl: targetRegistryUrl,
          });
          return { success: true, version };
        } catch (err) {
          uploadFailureMessage =
            err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: uploadFailureMessage,
          };
        }
      },
    },
  });

  if (result == null) {
    if (uploadFailureMessage != null) {
      return {
        success: false,
        cancelled: false,
        message: uploadFailureMessage,
      };
    }
    return { success: false, cancelled: true, message: "" };
  }

  // Sync local nori.json version on successful upload
  if (result.uploaded) {
    await writeSkillVersion({ skillDir, version: result.version });
  }

  return {
    success: true,
    cancelled: false,
    message: result.statusMessage,
  };
};
