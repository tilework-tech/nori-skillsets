/**
 * CLI command for uploading a single skill package to the Nori registrar.
 * Handles: nori-skillsets upload-skill <skill> [--skillset <name>] [--registry <url>] [--version <ver>] [--description <text>]
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import { log } from "@clack/prompts";
import * as semver from "semver";
import * as tar from "tar";

import {
  registrarApi,
  REGISTRAR_URL,
  type Packument,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { type CliName } from "@/cli/commands/cliCommandNames.js";
import {
  loadConfig,
  getActiveSkillset,
  getRegistryAuth,
  type Config,
  type RegistryAuth,
} from "@/cli/config.js";
import { skillUploadFlow } from "@/cli/prompts/flows/index.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { CheckExistingResult } from "@/cli/prompts/flows/skillUpload.js";
import type { NoriJson } from "@/norijson/nori.js";

/**
 * Files excluded from upload tarballs (local metadata that should not be distributed).
 */
const UPLOAD_EXCLUDED_FILES = new Set([".nori-version"]);

/**
 * Create a gzipped tarball from a single skill directory.
 *
 * @param args - Arguments
 * @param args.skillDir - Absolute path to the skill directory
 *
 * @returns Gzipped tarball as a Buffer
 */
const createSkillTarball = async (args: {
  skillDir: string;
}): Promise<Buffer> => {
  const { skillDir } = args;

  const entries = await fs.readdir(skillDir, {
    recursive: true,
    withFileTypes: true,
  });
  const filesToPack: Array<string> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (UPLOAD_EXCLUDED_FILES.has(entry.name)) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    const rel = path.relative(skillDir, full);
    filesToPack.push(rel);
  }

  const tempTarPath = path.join(
    skillDir,
    "..",
    `.${path.basename(skillDir)}-upload.tgz`,
  );

  try {
    await tar.create(
      { gzip: true, file: tempTarPath, cwd: skillDir },
      filesToPack,
    );
    return await fs.readFile(tempTarPath);
  } finally {
    await fs.unlink(tempTarPath).catch(() => undefined);
  }
};

/**
 * Extract a named file from an in-memory tarball (optionally gzipped).
 *
 * @param args - Arguments
 * @param args.tarballData - Raw tarball data (gzipped or plain tar)
 * @param args.fileName - File name to extract (matches both `SKILL.md` and `./SKILL.md`)
 *
 * @returns File contents as string, or null if the file is not in the tarball
 */
const extractFileFromTarball = async (args: {
  tarballData: ArrayBuffer;
  fileName: string;
}): Promise<string | null> => {
  const { tarballData, fileName } = args;
  const buffer = Buffer.from(tarballData);
  const readable = Readable.from(buffer);
  const isGzipped =
    buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

  let foundContent: string | null = null;

  const parser = new tar.Parser();
  parser.on("entry", (entry) => {
    // Match both "SKILL.md" at root and "./SKILL.md"
    const normalized = entry.path.replace(/^\.\//, "");
    if (normalized === fileName && foundContent == null) {
      const chunks: Array<Buffer> = [];
      entry.on("data", (chunk: Buffer) => chunks.push(chunk));
      entry.on("end", () => {
        foundContent = Buffer.concat(chunks).toString("utf-8");
      });
    } else {
      entry.resume();
    }
  });

  if (isGzipped) {
    await pipeline(readable, zlib.createGunzip(), parser);
  } else {
    await pipeline(readable, parser);
  }

  return foundContent;
};

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

  // Determine target URL from CLI flag, org namespace, or default
  const targetRegistryUrl =
    registryUrl != null
      ? registryUrl
      : orgId === "public"
        ? REGISTRAR_URL
        : buildOrganizationRegistryUrl({ orgId });

  // Org-scoped upload: verify membership when we have a known org list
  if (orgId !== "public") {
    const userOrgs = config?.auth?.organizations ?? null;
    if (userOrgs != null && !userOrgs.includes(orgId)) {
      return {
        ok: false,
        error: `You do not have access to organization "${orgId}".`,
        hint: `Your available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
      };
    }
  }

  // Public registry with unified auth — use the unified token directly,
  // matching the explicit branch in registryUpload.ts.
  let registryAuth: RegistryAuth | null = null;
  if (
    orgId === "public" &&
    registryUrl == null &&
    (config?.auth?.refreshToken != null || config?.auth?.apiToken != null)
  ) {
    registryAuth = {
      registryUrl: REGISTRAR_URL,
      username: config.auth.username ?? null,
      refreshToken: config.auth.refreshToken,
      apiToken: config.auth.apiToken ?? null,
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
    (config?.auth?.refreshToken != null || config?.auth?.apiToken != null)
  ) {
    registryAuth = {
      registryUrl: targetRegistryUrl,
      username: config.auth.username ?? null,
      refreshToken: config.auth.refreshToken,
      apiToken: config.auth.apiToken ?? null,
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
    version: explicitVersion,
    description: cliDescription,
    nonInteractive,
  } = args;

  // Parse the skill spec (supports "name", "org/name", "name@version")
  const parsed = parseNamespacedPackage({ packageSpec: skillSpec });
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
  const skillDisplayName =
    orgId === "public" ? skillName : `${orgId}/${skillName}`;

  const effectiveVersion = explicitVersion ?? specVersion ?? null;

  // Load config to resolve active skillset + auth
  const config = await loadConfig();

  // Resolve source skillset
  const sourceSkillset =
    skillset ?? (config != null ? getActiveSkillset({ config }) : null);

  if (sourceSkillset == null) {
    log.error(
      "No active skillset set. Pass --skillset <name> or activate a skillset with `nori-skillsets switch <name>`.",
    );
    return {
      success: false,
      cancelled: false,
      message: "No active skillset",
    };
  }

  const skillsetsDir = getNoriSkillsetsDir();
  const skillDir = path.join(skillsetsDir, sourceSkillset, "skills", skillName);

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
          (await extractFileFromTarball({
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
          return {
            success: false,
            error: `Invalid version: "${version}"`,
          };
        }
        const tarballBuffer = await createSkillTarball({ skillDir });
        const archiveData = new ArrayBuffer(tarballBuffer.byteLength);
        new Uint8Array(archiveData).set(tarballBuffer);

        try {
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
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
  });

  if (result == null) {
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
