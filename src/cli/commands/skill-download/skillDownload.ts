/**
 * CLI command for downloading skill packages from the Nori registrar
 * Handles: nori-ai skill-download <skill>[@version] [--registry <url>]
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import * as semver from "semver";
import * as tar from "tar";

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  checkRegistryAgentSupport,
  showCursorAgentNotSupportedError,
} from "@/cli/commands/registryAgentCheck.js";
import { getRegistryAuth } from "@/cli/config.js";
import { getNoriSkillsDir } from "@/cli/features/claude-code/paths.js";
import { error, success, info, newline, raw } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import type { Packument } from "@/api/registrar.js";
import type { Config } from "@/cli/config.js";
import type { Command } from "commander";

/**
 * Version info stored in .nori-version file
 */
type VersionInfo = {
  version: string;
  registryUrl: string;
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
 * Parse skill name and optional version from skill spec
 * Supports formats: "skill-name" or "skill-name@1.0.0"
 * @param args - The parsing parameters
 * @param args.skillSpec - Skill specification string
 *
 * @returns Parsed skill name and optional version
 */
const parseSkillSpec = (args: {
  skillSpec: string;
}): { skillName: string; version?: string | null } => {
  const { skillSpec } = args;
  const match = skillSpec.match(/^([a-z0-9-]+)(?:@(\d+\.\d+\.\d+.*))?$/i);

  if (!match) {
    return { skillName: skillSpec, version: null };
  }

  return {
    skillName: match[1],
    version: match[2] ?? null,
  };
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
 * Result of searching for a skill in a registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  packument: Packument;
  authToken?: string | null;
};

/**
 * Search all registries for a skill
 * Public registry is searched without auth, private registries require auth
 * @param args - The search parameters
 * @param args.skillName - The skill name to search for
 * @param args.config - The Nori configuration containing registry auth
 *
 * @returns Array of registries where the skill was found
 */
const searchAllRegistries = async (args: {
  skillName: string;
  config: Config | null;
}): Promise<Array<RegistrySearchResult>> => {
  const { skillName, config } = args;
  const results: Array<RegistrySearchResult> = [];

  // Search public registry first (no auth needed)
  try {
    const packument = await registrarApi.getSkillPackument({
      skillName,
      registryUrl: REGISTRAR_URL,
    });
    results.push({
      registryUrl: REGISTRAR_URL,
      packument,
    });
  } catch {
    // Skill not found in public registry - continue to private registries
  }

  // Search private registries from config (auth required)
  if (config?.registryAuths != null) {
    for (const registryAuth of config.registryAuths) {
      try {
        // Get auth token for this registry
        const authToken = await getRegistryAuthToken({ registryAuth });

        const packument = await registrarApi.getSkillPackument({
          skillName,
          registryUrl: registryAuth.registryUrl,
          authToken,
        });

        results.push({
          registryUrl: registryAuth.registryUrl,
          packument,
          authToken,
        });
      } catch {
        // Skill not found or auth failed for this registry - continue
      }
    }
  }

  return results;
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
 *
 * @returns Formatted version list message
 */
const formatVersionList = (args: {
  skillName: string;
  packument: Packument;
  registryUrl: string;
}): string => {
  const { skillName, packument, registryUrl } = args;
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
    `\nTo download a specific version:\n  nori-ai skill-download ${skillName}@<version>`,
  );

  return lines.join("\n");
};

/**
 * Format the multiple skills found error message
 * @param args - The format parameters
 * @param args.skillName - The skill name that was searched
 * @param args.results - The search results from multiple registries
 *
 * @returns Formatted error message
 */
const formatMultipleSkillsError = (args: {
  skillName: string;
  results: Array<RegistrySearchResult>;
}): string => {
  const { skillName, results } = args;

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
      `nori-ai skill-download ${skillName} --registry ${result.registryUrl}`,
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
 */
export const skillDownloadMain = async (args: {
  skillSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
}): Promise<void> => {
  const { skillSpec, installDir, registryUrl, listVersions } = args;
  const cwd = args.cwd ?? process.cwd();

  const { skillName, version } = parseSkillSpec({ skillSpec });

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

  const skillsDir = getNoriSkillsDir({ installDir: targetInstallDir });
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
  } else {
    // Search all registries
    searchResults = await searchAllRegistries({ skillName, config });
  }

  // Handle search results
  if (searchResults.length === 0) {
    error({
      message: `Skill "${skillName}" not found in any registry.`,
    });
    return;
  }

  if (searchResults.length > 1) {
    error({
      message: formatMultipleSkillsError({
        skillName,
        results: searchResults,
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
        message: `Skill "${skillName}" already exists at:\n${targetDir}\n\nThis skill has no version information (.nori-version file).\nIt may have been installed manually or with an older version of Nori.\n\nTo reinstall:\n  rm -rf "${targetDir}"\n  nori-ai skill-download ${skillName}`,
      });
      return;
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
            message: `Skill "${skillName}" is already at version ${installedVersion}.`,
          });
        } else {
          success({
            message: `Skill "${skillName}" is already at version ${installedVersion} (requested ${targetVersion}).`,
          });
        }
        return;
      }
      // Newer version available - will proceed to update
      info({
        message: `Updating skill "${skillName}" from ${installedVersion} to ${targetVersion}...`,
      });
    } else if (installedVersion === targetVersion) {
      // Fallback for non-semver versions
      success({
        message: `Skill "${skillName}" is already at version ${installedVersion}.`,
      });
      return;
    }
  }

  // Download and extract the tarball
  try {
    if (!skillExists) {
      info({ message: `Downloading skill "${skillName}"...` });
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
    await fs.writeFile(
      path.join(targetDir, ".nori-version"),
      JSON.stringify(
        {
          version: targetVersion,
          registryUrl: selectedRegistry.registryUrl,
        },
        null,
        2,
      ),
    );

    const versionStr = version ? `@${version}` : " (latest)";
    newline();
    if (skillExists) {
      success({
        message: `Updated skill "${skillName}" to ${targetVersion}`,
      });
    } else {
      success({
        message: `Downloaded and installed skill "${skillName}"${versionStr}`,
      });
    }
    info({ message: `Installed to: ${targetDir}` });
    newline();
    info({
      message: `You can now reference this skill in your profile's skills.json.`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to download skill "${skillName}": ${errorMessage}`,
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
    .action(
      async (
        skillSpec: string,
        options: { registry?: string; listVersions?: boolean },
      ) => {
        const globalOpts = program.opts();

        await skillDownloadMain({
          skillSpec,
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
        });
      },
    );
};
