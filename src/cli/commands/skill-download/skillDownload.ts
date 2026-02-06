/**
 * CLI command for downloading skill packages from the Nori registrar
 * Handles: nori-skillsets download-skill <skill>[@version] [--registry <url>]
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import * as semver from "semver";
import * as tar from "tar";

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import { getRegistryAuth, loadConfig, getAgentProfile } from "@/cli/config.js";
import {
  getClaudeSkillsDir,
  getNoriProfilesDir,
} from "@/cli/features/claude-code/paths.js";
import { addSkillToNoriJson } from "@/cli/features/claude-code/profiles/metadata.js";
import { addSkillDependency } from "@/cli/features/claude-code/profiles/skills/resolver.js";
import { substituteTemplatePaths } from "@/cli/features/claude-code/template.js";
import { error, success, info, newline, raw, warn } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { Packument } from "@/api/registrar.js";
import type { Config } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Version info stored in .nori-version file
 */
type VersionInfo = {
  version: string;
  registryUrl: string;
  orgId?: string | null;
};

/**
 * Read the .nori-version file from a skill directory
 * @param args - The function arguments
 * @param args.skillDir - The skill directory path
 *
 * @returns The version info or null if not found
 */
const readVersionInfo = async (args: {
  skillDir: string;
}): Promise<VersionInfo | null> => {
  const { skillDir } = args;
  const versionFilePath = path.join(skillDir, ".nori-version");

  try {
    const content = await fs.readFile(versionFilePath, "utf-8");
    return JSON.parse(content) as VersionInfo;
  } catch {
    return null;
  }
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
 * Copy a directory recursively
 * @param args - The copy parameters
 * @param args.src - Source directory path
 * @param args.dest - Destination directory path
 */
const copyDirRecursive = async (args: {
  src: string;
  dest: string;
}): Promise<void> => {
  const { src, dest } = args;
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive({ src: srcPath, dest: destPath });
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

/**
 * Apply template substitution to all .md files in a directory recursively
 * @param args - The substitution parameters
 * @param args.dir - Directory to process
 * @param args.installDir - The .claude directory path for template substitution
 */
const applyTemplateSubstitutionToDir = async (args: {
  dir: string;
  installDir: string;
}): Promise<void> => {
  const { dir, installDir } = args;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await applyTemplateSubstitutionToDir({ dir: entryPath, installDir });
    } else if (entry.name.endsWith(".md")) {
      const content = await fs.readFile(entryPath, "utf-8");
      const substituted = substituteTemplatePaths({ content, installDir });
      await fs.writeFile(entryPath, substituted);
    }
  }
};

/**
 * Result of searching for a skill in a registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  packument: Packument;
  authToken?: string | null;
};

/**
 * Search a specific registry for a skill
 * @param args - The search parameters
 * @param args.skillName - The skill name to search for
 * @param args.registryUrl - The registry URL to search
 * @param args.config - The Nori configuration containing registry auth
 *
 * @returns The search result or null if not found or no auth configured
 */
const searchSpecificRegistry = async (args: {
  skillName: string;
  registryUrl: string;
  config: Config | null;
}): Promise<RegistrySearchResult | null> => {
  const { skillName, registryUrl, config } = args;

  // Check if this is the public registry
  if (registryUrl === REGISTRAR_URL) {
    try {
      const packument = await registrarApi.getSkillPackument({
        skillName,
        registryUrl: REGISTRAR_URL,
      });
      return {
        registryUrl: REGISTRAR_URL,
        packument,
      };
    } catch {
      return null;
    }
  }

  // Private registry - require auth from config
  if (config == null) {
    return null;
  }

  const registryAuth = getRegistryAuth({ config, registryUrl });
  if (registryAuth == null) {
    return null;
  }

  try {
    const authToken = await getRegistryAuthToken({ registryAuth });
    const packument = await registrarApi.getSkillPackument({
      skillName,
      registryUrl,
      authToken,
    });
    return {
      registryUrl,
      packument,
      authToken,
    };
  } catch {
    return null;
  }
};

/**
 * Format the list of available versions for a skill
 * @param args - The format parameters
 * @param args.skillName - The skill name
 * @param args.packument - The packument containing version information
 * @param args.registryUrl - The registry URL
 * @param args.cliName - The CLI name for command hints
 *
 * @returns Formatted version list message
 */
const formatVersionList = (args: {
  skillName: string;
  packument: Packument;
  registryUrl: string;
  cliName?: CliName | null;
}): string => {
  const { skillName, packument, registryUrl, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";
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
    `Available versions of "${skillName}" from ${registryUrl}:\n`,
    "Dist-tags:",
  ];

  // Show dist-tags first
  for (const [tag, version] of Object.entries(distTags)) {
    lines.push(`  ${tag}: ${version}`);
  }

  lines.push("\nVersions:");

  // Show all versions with timestamps
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
    `\nTo download a specific version:\n  ${cliPrefix} ${commandNames.downloadSkill} ${skillName}@<version>`,
  );

  return lines.join("\n");
};

/**
 * Format the multiple skills found error message
 * @param args - The format parameters
 * @param args.skillName - The skill name that was searched
 * @param args.results - The search results from multiple registries
 * @param args.cliName - The CLI name for command hints
 *
 * @returns Formatted error message
 */
const formatMultipleSkillsError = (args: {
  skillName: string;
  results: Array<RegistrySearchResult>;
  cliName?: CliName | null;
}): string => {
  const { skillName, results, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";

  const lines = ["Multiple skills with the same name found.\n"];

  for (const result of results) {
    const version = result.packument["dist-tags"].latest ?? "unknown";
    const description = result.packument.description ?? "";
    lines.push(result.registryUrl);
    lines.push(`  -> ${skillName}@${version}: ${description}\n`);
  }

  lines.push("To download, please specify the registry with --registry:");
  for (const result of results) {
    lines.push(
      `${cliPrefix} ${commandNames.downloadSkill} ${skillName} --registry ${result.registryUrl}`,
    );
  }

  return lines.join("\n");
};

/**
 * Download and install a skill from the registrar
 * @param args - The download parameters
 * @param args.skillSpec - Skill name with optional version (e.g., "my-skill" or "my-skill@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL to download from
 * @param args.listVersions - If true, list available versions instead of downloading
 * @param args.skillset - Optional skillset name to add skill to (defaults to active profile)
 * @param args.cliName - CLI name for user-facing messages (defaults to nori-skillsets)
 */
export const skillDownloadMain = async (args: {
  skillSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
  skillset?: string | null;
  cliName?: CliName | null;
}): Promise<void> => {
  const {
    skillSpec,
    installDir,
    registryUrl,
    listVersions,
    skillset,
    cliName,
  } = args;
  const cwd = args.cwd ?? process.cwd();
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";

  // Parse the namespaced skill spec (e.g., "myorg/my-skill@1.0.0")
  const parsed = parseNamespacedPackage({ packageSpec: skillSpec });
  if (parsed == null) {
    error({
      message: `Invalid skill specification: "${skillSpec}".\nExpected format: skill-name or org/skill-name[@version]`,
    });
    return;
  }
  const { orgId, packageName: skillName, version } = parsed;
  // Display name includes org prefix for namespaced packages (e.g., "myorg/my-skill")
  const skillDisplayName =
    orgId === "public" ? skillName : `${orgId}/${skillName}`;

  // Check for namespace/registry conflict
  if (orgId !== "public" && registryUrl != null) {
    error({
      message: `Cannot specify both namespace and --registry flag.\n\nThe namespace "${orgId}/" determines the registry automatically.\nUse either "${skillDisplayName}" (derived registry) or "${skillName} --registry ${registryUrl}" (explicit registry).`,
    });
    return;
  }

  // Find installation directory
  // If installDir is provided, use it; otherwise check for existing installations
  // If no installations found, use cwd (skills can be downloaded without prior Nori installation)
  let targetInstallDir: string;

  if (installDir != null) {
    targetInstallDir = installDir;
  } else {
    const allInstallations = getInstallDirs({ currentDir: cwd });

    if (allInstallations.length === 0) {
      // No installation - use home directory as target
      targetInstallDir = os.homedir();
    } else if (allInstallations.length > 1) {
      const installList = allInstallations
        .map((dir, index) => `${index + 1}. ${dir}`)
        .join("\n");

      error({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease use --install-dir to specify the target installation.`,
      });
      return;
    } else {
      targetInstallDir = allInstallations[0];
    }
  }

  // Load config if it exists (for private registry auth)
  const config = await loadConfig({ installDir: targetInstallDir });

  // Resolve target skillset for manifest update
  // Priority: --skillset option > active profile from config > no manifest update
  let targetSkillset: string | null = null;
  const profilesDir = getNoriProfilesDir({ installDir: targetInstallDir });

  if (skillset != null) {
    // User specified a skillset - verify it exists
    const skillsetDir = path.join(profilesDir, skillset);
    const skillsetClaudeMd = path.join(skillsetDir, "CLAUDE.md");
    try {
      await fs.access(skillsetClaudeMd);
      targetSkillset = skillset;
    } catch {
      error({
        message: `Skillset "${skillset}" not found at: ${skillsetDir}\n\nMake sure the skillset exists and contains a CLAUDE.md file.`,
      });
      return;
    }
  } else if (config != null) {
    // No skillset specified - try to use active profile
    const activeProfile = getAgentProfile({
      config,
      agentName: "claude-code",
    });
    if (activeProfile != null) {
      // Verify profile directory exists
      const profileDir = path.join(profilesDir, activeProfile.baseProfile);
      try {
        await fs.access(profileDir);
        targetSkillset = activeProfile.baseProfile;
      } catch {
        // Profile directory doesn't exist - skip manifest update
      }
    }
  }

  const skillsDir = getClaudeSkillsDir({ installDir: targetInstallDir });

  // Ensure skills directory exists
  await fs.mkdir(skillsDir, { recursive: true });

  const targetDir = path.join(skillsDir, skillName);

  // Check if skill already exists and get its version info
  let existingVersionInfo: VersionInfo | null = null;
  let skillExists = false;
  try {
    await fs.access(targetDir);
    skillExists = true;
    existingVersionInfo = await readVersionInfo({ skillDir: targetDir });
  } catch {
    // Directory doesn't exist - continue
  }

  // Search for the skill
  let searchResults: Array<RegistrySearchResult>;

  // Check if using unified auth with organizations (new flow)
  const hasUnifiedAuthWithOrgs =
    config?.auth != null &&
    config.auth.refreshToken != null &&
    config.auth.organizations != null;

  if (registryUrl != null) {
    // User specified a specific registry
    // Check if private registry requires auth
    if (registryUrl !== REGISTRAR_URL) {
      const registryAuth =
        config != null ? getRegistryAuth({ config, registryUrl }) : null;
      if (registryAuth == null) {
        error({
          message: `No authentication configured for registry: ${registryUrl}\n\nAdd registry credentials to your .nori-config.json file.`,
        });
        return;
      }
    }

    const result = await searchSpecificRegistry({
      skillName,
      registryUrl,
      config,
    });
    searchResults = result != null ? [result] : [];
  } else if (hasUnifiedAuthWithOrgs) {
    // New flow: derive registry from namespace
    const targetRegistryUrl = buildOrganizationRegistryUrl({ orgId });
    const userOrgs = config.auth!.organizations!;

    // Check if user has access to this org
    if (!userOrgs.includes(orgId)) {
      error({
        message: `You do not have access to organization "${orgId}".\n\nCannot download "${skillDisplayName}" from ${targetRegistryUrl}.\n\nYour available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
      });
      return;
    }

    // Get auth token for the org registry
    const registryAuth = {
      registryUrl: targetRegistryUrl,
      username: config.auth!.username,
      refreshToken: config.auth!.refreshToken,
    };

    try {
      const authToken = await getRegistryAuthToken({ registryAuth });
      const packument = await registrarApi.getSkillPackument({
        skillName,
        registryUrl: targetRegistryUrl,
        authToken,
      });

      searchResults = [
        {
          registryUrl: targetRegistryUrl,
          packument,
          authToken,
        },
      ];
    } catch {
      // Skill not found in org registry
      searchResults = [];
    }
  } else if (orgId === "public") {
    // Unnamespaced skill: search public registry only (no auth needed)
    try {
      const packument = await registrarApi.getSkillPackument({
        skillName,
        registryUrl: REGISTRAR_URL,
      });
      searchResults = [
        {
          registryUrl: REGISTRAR_URL,
          packument,
        },
      ];
    } catch {
      searchResults = [];
    }
  } else {
    // Namespaced skill without unified auth: require login
    const displayName = `${orgId}/${skillName}`;
    error({
      message: `Skill "${displayName}" not found. To download from organization "${orgId}", log in with:\n\n  nori-skillsets login`,
    });
    return;
  }

  // Handle search results
  if (searchResults.length === 0) {
    error({
      message: `Skill "${skillDisplayName}" not found in any registry.`,
    });
    return;
  }

  if (searchResults.length > 1) {
    error({
      message: formatMultipleSkillsError({
        skillName,
        results: searchResults,
        cliName,
      }),
    });
    return;
  }

  // Single result - download from that registry
  const selectedRegistry = searchResults[0];

  // If --list-versions flag is set, show versions and exit
  if (listVersions) {
    raw({
      message: formatVersionList({
        skillName,
        packument: selectedRegistry.packument,
        registryUrl: selectedRegistry.registryUrl,
        cliName,
      }),
    });
    return;
  }

  // Determine the target version
  const targetVersion =
    version ?? selectedRegistry.packument["dist-tags"].latest;

  // If skill already exists, check version
  if (skillExists) {
    if (existingVersionInfo == null) {
      // Skill exists but has no .nori-version - manual install
      error({
        message: `Skill "${skillDisplayName}" already exists at:\n${targetDir}\n\nThis skill has no version information (.nori-version file).\nIt may have been installed manually or with an older version of Nori.\n\nTo reinstall:\n  rm -rf "${targetDir}"\n  ${cliPrefix} ${commandNames.downloadSkill} ${skillDisplayName}`,
      });
      return;
    }

    // Check for org collision - warn if installing from different org
    const existingOrgId = existingVersionInfo.orgId ?? "public";
    if (existingOrgId !== orgId) {
      const existingDisplayName =
        existingOrgId === "public"
          ? skillName
          : `${existingOrgId}/${skillName}`;
      warn({
        message: `Warning: Skill "${skillName}" is currently installed from "${existingDisplayName}" (${existingOrgId}).\nThis will be overwritten with "${skillDisplayName}" (${orgId}).`,
      });
    }

    const installedVersion = existingVersionInfo.version;

    // Compare versions
    const installedValid = semver.valid(installedVersion) != null;
    const targetValid = semver.valid(targetVersion) != null;

    if (installedValid && targetValid) {
      if (semver.gte(installedVersion, targetVersion)) {
        // Already at same or newer version
        if (installedVersion === targetVersion) {
          success({
            message: `Skill "${skillDisplayName}" is already at version ${installedVersion}.`,
          });
        } else {
          success({
            message: `Skill "${skillDisplayName}" is already at version ${installedVersion} (requested ${targetVersion}).`,
          });
        }
        return;
      }
      // Newer version available - will proceed to update
      info({
        message: `Updating skill "${skillDisplayName}" from ${installedVersion} to ${targetVersion}...`,
      });
    } else if (installedVersion === targetVersion) {
      // Fallback for non-semver versions
      success({
        message: `Skill "${skillDisplayName}" is already at version ${installedVersion}.`,
      });
      return;
    }
  }

  // Download and extract the tarball
  try {
    if (!skillExists) {
      info({ message: `Downloading skill "${skillDisplayName}"...` });
    }

    const tarballData = await registrarApi.downloadSkillTarball({
      skillName,
      version: version ?? undefined,
      registryUrl: selectedRegistry.registryUrl,
      authToken: selectedRegistry.authToken ?? undefined,
    });

    if (skillExists) {
      // Update existing skill - use atomic swap via backup directory
      const tempDir = path.join(skillsDir, `.${skillName}-download-temp`);
      const backupDir = path.join(skillsDir, `.${skillName}-backup`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        await extractTarball({ tarballData, targetDir: tempDir });
      } catch (extractErr) {
        // Clean up temp directory on extraction failure
        await fs.rm(tempDir, { recursive: true, force: true });
        throw extractErr;
      }

      // Atomic swap: rename existing to backup, rename temp to target
      // This ensures the skill directory is never in a corrupted state
      try {
        // Move existing skill to backup
        await fs.rename(targetDir, backupDir);

        // Move new version to target
        await fs.rename(tempDir, targetDir);

        // Copy .nori-version from backup if it existed (will be updated later)
        const backupVersionFile = path.join(backupDir, ".nori-version");
        try {
          await fs.access(backupVersionFile);
          await fs.copyFile(
            backupVersionFile,
            path.join(targetDir, ".nori-version"),
          );
        } catch {
          // No .nori-version in backup, that's fine
        }

        // Clean up backup
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch (swapErr) {
        // Restore from backup if swap failed
        try {
          await fs.access(backupDir);
          // Backup exists - try to restore
          await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {
            // Target may not exist, that's fine
          });
          await fs.rename(backupDir, targetDir);
        } catch {
          // Backup doesn't exist or restore failed
        }
        // Clean up temp if it still exists
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
          // Temp may not exist, that's fine
        });
        throw swapErr;
      }
    } else {
      // New install - create target directory and extract
      await fs.mkdir(targetDir, { recursive: true });

      try {
        await extractTarball({ tarballData, targetDir });
      } catch (extractErr) {
        // Clean up on extraction failure
        await fs.rm(targetDir, { recursive: true, force: true });
        throw extractErr;
      }
    }

    // Write .nori-version file for update tracking
    const versionData = JSON.stringify(
      {
        version: targetVersion,
        registryUrl: selectedRegistry.registryUrl,
        orgId,
      },
      null,
      2,
    );
    await fs.writeFile(path.join(targetDir, ".nori-version"), versionData);

    // Persist skill to profile's skills directory (raw files, no template substitution)
    if (targetSkillset != null) {
      const profileSkillDir = path.join(
        profilesDir,
        targetSkillset,
        "skills",
        skillName,
      );
      try {
        await fs.rm(profileSkillDir, { recursive: true, force: true });
        await copyDirRecursive({ src: targetDir, dest: profileSkillDir });
      } catch (profileCopyErr) {
        const profileCopyErrMsg =
          profileCopyErr instanceof Error
            ? profileCopyErr.message
            : String(profileCopyErr);
        info({
          message: `Warning: Could not persist skill to profile: ${profileCopyErrMsg}`,
        });
      }
    }

    // Apply template substitution to .md files in the live copy
    const claudeDir = path.join(targetInstallDir, ".claude");
    await applyTemplateSubstitutionToDir({
      dir: targetDir,
      installDir: claudeDir,
    });

    const versionStr = version ? `@${version}` : " (latest)";
    newline();
    if (skillExists) {
      success({
        message: `Updated skill "${skillDisplayName}" to ${targetVersion}`,
      });
    } else {
      success({
        message: `Downloaded and installed skill "${skillDisplayName}"${versionStr}`,
      });
    }
    info({ message: `Installed to: ${targetDir}` });

    // Update skillset manifest if we have a target skillset
    if (targetSkillset != null) {
      const skillsetDir = path.join(profilesDir, targetSkillset);
      try {
        await addSkillDependency({
          profileDir: skillsetDir,
          skillName,
          version: "*",
        });
        info({
          message: `Added "${skillDisplayName}" to ${targetSkillset} skillset manifest`,
        });
      } catch (manifestErr) {
        // Don't fail the download if manifest update fails
        const manifestErrMsg =
          manifestErr instanceof Error
            ? manifestErr.message
            : String(manifestErr);
        info({
          message: `Warning: Could not update skillset manifest: ${manifestErrMsg}`,
        });
      }
    } else {
      info({
        message: `No active skillset - skill not added to any manifest`,
      });
    }

    // Update nori.json with the skill dependency
    if (targetSkillset != null) {
      const skillsetDir = path.join(profilesDir, targetSkillset);
      try {
        await addSkillToNoriJson({
          profileDir: skillsetDir,
          skillName,
          version: "*",
        });
        info({
          message: `Added "${skillName}" to ${targetSkillset} nori.json dependencies`,
        });
      } catch (noriJsonErr) {
        const noriJsonErrMsg =
          noriJsonErr instanceof Error
            ? noriJsonErr.message
            : String(noriJsonErr);
        info({
          message: `Warning: Could not update nori.json: ${noriJsonErrMsg}`,
        });
      }
    }

    newline();
    info({
      message: `Skill "${skillDisplayName}" is now available in your Claude Code profile.`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to download skill "${skillDisplayName}": ${errorMessage}`,
    });
  }
};

/**
 * Register the 'skill-download' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSkillDownloadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("skill-download <skill>")
    .description("Download and install a skill package from the Nori registrar")
    .option(
      "--registry <url>",
      "Download from a specific registry URL instead of searching all registries",
    )
    .option(
      "--list-versions",
      "List available versions for the skill instead of downloading",
    )
    .option(
      "--skillset <name>",
      "Add skill to the specified skillset's manifest (defaults to active skillset)",
    )
    .action(
      async (
        skillSpec: string,
        options: {
          registry?: string;
          listVersions?: boolean;
          skillset?: string;
        },
      ) => {
        const globalOpts = program.opts();

        await skillDownloadMain({
          skillSpec,
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
          skillset: options.skillset || null,
        });
      },
    );
};
