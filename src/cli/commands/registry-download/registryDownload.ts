/**
 * CLI command for downloading profile packages from the Nori registrar
 * Handles: nori-ai registry-download <package>[@version] [--registry <url>]
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import * as semver from "semver";
import * as tar from "tar";

import {
  registrarApi,
  REGISTRAR_URL,
  type Packument,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import { initMain } from "@/cli/commands/init/init.js";
import {
  checkRegistryAgentSupport,
  showCursorAgentNotSupportedError,
} from "@/cli/commands/registryAgentCheck.js";
import { getRegistryAuth } from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { error, success, info, newline, raw } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

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
 * nori.json manifest format for profiles
 */
type NoriJson = {
  name: string;
  version: string;
  dependencies?: {
    skills?: Record<string, string> | null;
  } | null;
};

/**
 * Read the .nori-version file from a directory
 * @param args - The function arguments
 * @param args.dir - The directory path containing the .nori-version file
 *
 * @returns The version info or null if not found
 */
const readVersionInfo = async (args: {
  dir: string;
}): Promise<VersionInfo | null> => {
  const { dir } = args;
  const versionFilePath = path.join(dir, ".nori-version");

  try {
    const content = await fs.readFile(versionFilePath, "utf-8");
    return JSON.parse(content) as VersionInfo;
  } catch {
    return null;
  }
};

/**
 * Read the nori.json file from a profile directory
 * @param args - The function arguments
 * @param args.profileDir - The profile directory path
 *
 * @returns The nori.json content or null if not found
 */
const readNoriJson = async (args: {
  profileDir: string;
}): Promise<NoriJson | null> => {
  const { profileDir } = args;
  const noriJsonPath = path.join(profileDir, "nori.json");

  try {
    const content = await fs.readFile(noriJsonPath, "utf-8");
    return JSON.parse(content) as NoriJson;
  } catch {
    return null;
  }
};

/**
 * Download and install a single skill dependency (always uses latest version)
 * @param args - The download parameters
 * @param args.skillName - The name of the skill to download
 * @param args.skillsDir - The directory where skills are installed
 * @param args.registryUrl - The registry URL to download from
 * @param args.authToken - Optional authentication token for private registries
 *
 * @returns True if skill was downloaded/updated, false if skipped or failed
 */
const downloadSkillDependency = async (args: {
  skillName: string;
  skillsDir: string;
  registryUrl: string;
  authToken?: string | null;
}): Promise<boolean> => {
  const { skillName, skillsDir, registryUrl, authToken } = args;
  const skillDir = path.join(skillsDir, skillName);

  try {
    // Fetch skill packument to get latest version
    const packument = await registrarApi.getSkillPackument({
      skillName,
      registryUrl,
      authToken: authToken ?? undefined,
    });

    const latestVersion = packument["dist-tags"].latest;
    if (latestVersion == null) {
      info({
        message: `Warning: No latest version found for skill "${skillName}"`,
      });
      return false;
    }

    // Check if skill already exists with same version
    let skillExists = false;
    try {
      await fs.access(skillDir);
      skillExists = true;
    } catch {
      // Skill doesn't exist
    }

    if (skillExists) {
      const existingVersionInfo = await readVersionInfo({ dir: skillDir });
      if (existingVersionInfo != null) {
        // Skip if already at latest version
        if (existingVersionInfo.version === latestVersion) {
          return false; // Already installed with latest version
        }
      }
    }

    // Download the skill tarball (latest version)
    const tarballData = await registrarApi.downloadSkillTarball({
      skillName,
      version: latestVersion,
      registryUrl,
      authToken: authToken ?? undefined,
    });

    // Extract to skill directory
    if (skillExists) {
      // Update existing skill - extract to temp dir first
      const tempDir = path.join(skillsDir, `.${skillName}-download-temp`);
      const backupDir = path.join(skillsDir, `.${skillName}-backup`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        await extractTarball({ tarballData, targetDir: tempDir });

        // Atomic swap
        await fs.rename(skillDir, backupDir);
        await fs.rename(tempDir, skillDir);
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch (err) {
        // Restore from backup if swap failed
        try {
          await fs.access(backupDir);
          await fs.rm(skillDir, { recursive: true, force: true }).catch(() => {
            /* ignore */
          });
          await fs.rename(backupDir, skillDir);
        } catch {
          /* ignore */
        }
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
          /* ignore */
        });
        throw err;
      }
    } else {
      // New install
      await fs.mkdir(skillDir, { recursive: true });
      await extractTarball({ tarballData, targetDir: skillDir });
    }

    // Write .nori-version file
    await fs.writeFile(
      path.join(skillDir, ".nori-version"),
      JSON.stringify(
        {
          version: latestVersion,
          registryUrl,
        },
        null,
        2,
      ),
    );

    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    info({
      message: `Warning: Failed to download skill "${skillName}": ${errorMessage}`,
    });
    return false;
  }
};

/**
 * Download all skill dependencies from a nori.json (always uses latest versions)
 * @param args - The download parameters
 * @param args.noriJson - The parsed nori.json manifest containing dependencies
 * @param args.skillsDir - The directory where skills are installed
 * @param args.registryUrl - The registry URL to download from
 * @param args.authToken - Optional authentication token for private registries
 */
const downloadSkillDependencies = async (args: {
  noriJson: NoriJson;
  skillsDir: string;
  registryUrl: string;
  authToken?: string | null;
}): Promise<void> => {
  const { noriJson, skillsDir, registryUrl, authToken } = args;

  const skillDeps = noriJson.dependencies?.skills;
  if (skillDeps == null || Object.keys(skillDeps).length === 0) {
    return;
  }

  info({ message: "Installing skill dependencies..." });

  for (const skillName of Object.keys(skillDeps)) {
    await downloadSkillDependency({
      skillName,
      skillsDir,
      registryUrl,
      authToken,
    });
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
 * Result of searching for a package in a registry
 */
type RegistrySearchResult = {
  registryUrl: string;
  packument: Packument;
  authToken?: string | null;
};

/**
 * Search all registries for a package
 * Public registry is searched without auth, private registries require auth
 * @param args - The search parameters
 * @param args.packageName - The package name to search for
 * @param args.config - The Nori configuration containing registry auth
 *
 * @returns Array of registries where the package was found
 */
const searchAllRegistries = async (args: {
  packageName: string;
  config: Config | null;
}): Promise<Array<RegistrySearchResult>> => {
  const { packageName, config } = args;
  const results: Array<RegistrySearchResult> = [];

  // Search public registry first (no auth needed)
  try {
    const packument = await registrarApi.getPackument({
      packageName,
      registryUrl: REGISTRAR_URL,
    });
    results.push({
      registryUrl: REGISTRAR_URL,
      packument,
    });
  } catch {
    // Package not found in public registry - continue to private registries
  }

  // Search private registries from config (auth required)
  if (config?.registryAuths != null) {
    for (const registryAuth of config.registryAuths) {
      try {
        // Get auth token for this registry
        const authToken = await getRegistryAuthToken({ registryAuth });

        const packument = await registrarApi.getPackument({
          packageName,
          registryUrl: registryAuth.registryUrl,
          authToken,
        });

        results.push({
          registryUrl: registryAuth.registryUrl,
          packument,
          authToken,
        });
      } catch {
        // Package not found or auth failed for this registry - continue
      }
    }
  }

  return results;
};

/**
 * Search a specific registry for a package
 * @param args - The search parameters
 * @param args.packageName - The package name to search for
 * @param args.registryUrl - The registry URL to search
 * @param args.config - The Nori configuration containing registry auth
 *
 * @returns The search result or null if not found or no auth configured
 */
const searchSpecificRegistry = async (args: {
  packageName: string;
  registryUrl: string;
  config: Config | null;
}): Promise<RegistrySearchResult | null> => {
  const { packageName, registryUrl, config } = args;

  // Check if this is the public registry
  if (registryUrl === REGISTRAR_URL) {
    try {
      const packument = await registrarApi.getPackument({
        packageName,
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
    const packument = await registrarApi.getPackument({
      packageName,
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
 * Format the list of available versions for a package
 * @param args - The format parameters
 * @param args.packageName - The package name
 * @param args.packument - The packument containing version information
 * @param args.registryUrl - The registry URL
 * @param args.cliName - The CLI name for command hints
 *
 * @returns Formatted version list message
 */
const formatVersionList = (args: {
  packageName: string;
  packument: Packument;
  registryUrl: string;
  cliName?: CliName | null;
}): string => {
  const { packageName, packument, registryUrl, cliName } = args;
  const commandNames = getCommandNames({ cliName });
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
    `Available versions of "${packageName}" from ${registryUrl}:\n`,
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

  const cliPrefix = cliName ?? "nori-ai";
  lines.push(
    `\nTo download a specific version:\n  ${cliPrefix} ${commandNames.download} ${packageName}@<version>`,
  );

  return lines.join("\n");
};

/**
 * Format the multiple packages found error message
 * @param args - The format parameters
 * @param args.packageName - The package name that was searched
 * @param args.results - The search results from multiple registries
 * @param args.cliName - The CLI name for command hints
 *
 * @returns Formatted error message
 */
const formatMultiplePackagesError = (args: {
  packageName: string;
  results: Array<RegistrySearchResult>;
  cliName?: CliName | null;
}): string => {
  const { packageName, results, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-ai";

  const lines = ["Multiple packages with the same name found.\n"];

  for (const result of results) {
    const version = result.packument["dist-tags"].latest ?? "unknown";
    const description = result.packument.description ?? "";
    lines.push(result.registryUrl);
    lines.push(`  -> ${packageName}@${version}: ${description}\n`);
  }

  lines.push("To download, please specify the registry with --registry:");
  for (const result of results) {
    lines.push(
      `${cliPrefix} ${commandNames.download} ${packageName} --registry ${result.registryUrl}`,
    );
  }

  return lines.join("\n");
};

/**
 * Result of registry download operation
 */
export type RegistryDownloadResult = {
  success: boolean;
};

/**
 * Download and install a profile from the registrar
 * @param args - The download parameters
 * @param args.packageSpec - Package name with optional version (e.g., "my-profile" or "my-profile@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL to download from
 * @param args.listVersions - If true, list available versions instead of downloading
 * @param args.cliName - CLI name for user-facing messages (nori-ai or nori-skillsets)
 *
 * @returns Result indicating success or failure
 */
export const registryDownloadMain = async (args: {
  packageSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
  cliName?: CliName | null;
}): Promise<RegistryDownloadResult> => {
  const { packageSpec, installDir, registryUrl, listVersions, cliName } = args;
  const cwd = args.cwd ?? process.cwd();
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-ai";

  // Parse the namespaced package spec (e.g., "myorg/my-profile@1.0.0")
  const parsed = parseNamespacedPackage({ packageSpec });
  if (parsed == null) {
    error({
      message: `Invalid package specification: "${packageSpec}".\nExpected format: profile-name or org/profile-name[@version]`,
    });
    return { success: false };
  }
  const { orgId, packageName, version } = parsed;
  // Display name includes org prefix for namespaced packages (e.g., "myorg/my-profile")
  const profileDisplayName =
    orgId === "public" ? packageName : `${orgId}/${packageName}`;

  // Find installation directory
  let targetInstallDir: string;

  if (installDir != null) {
    targetInstallDir = installDir;

    // Check if installation exists at the specified directory
    const allInstallations = getInstallDirs({ currentDir: installDir });
    if (!allInstallations.includes(installDir)) {
      // No installation at specified directory - auto-init (interactive to allow user prompts)
      // Skip the profile persistence warning since users are just trying to download a profile
      info({ message: "Setting up Nori for first time use..." });
      try {
        await initMain({
          installDir,
          nonInteractive: false,
          skipWarning: true,
        });
      } catch (err) {
        error({
          message: `Failed to initialize Nori: ${err instanceof Error ? err.message : String(err)}`,
        });
        return { success: false };
      }
    }
  } else {
    const allInstallations = getInstallDirs({ currentDir: cwd });

    // Also check ~/.nori as it typically has registry auth configured
    // For registry commands, prefer ~/.nori if it exists
    const homeNoriDir = path.join(os.homedir(), ".nori");
    const homeInstallations = getInstallDirs({ currentDir: homeNoriDir });

    // Prefer ~/.nori if it exists (typically has registry auth)
    if (homeInstallations.includes(homeNoriDir)) {
      targetInstallDir = homeNoriDir;
    } else if (allInstallations.length === 0) {
      // No installation found - auto-init at cwd (interactive to allow user prompts)
      // Skip the profile persistence warning since users are just trying to download a profile
      info({ message: "Setting up Nori for first time use..." });
      try {
        await initMain({
          installDir: cwd,
          nonInteractive: false,
          skipWarning: true,
        });
      } catch (err) {
        error({
          message: `Failed to initialize Nori: ${err instanceof Error ? err.message : String(err)}`,
        });
        return { success: false };
      }
      targetInstallDir = cwd;
    } else if (allInstallations.length > 1) {
      const installList = allInstallations
        .map((dir, index) => `${index + 1}. ${dir}`)
        .join("\n");

      error({
        message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease use --install-dir to specify the target installation.`,
      });
      return { success: false };
    } else {
      targetInstallDir = allInstallations[0];
    }
  }

  // Check if cursor-agent-only installation (not supported for registry commands)
  const agentCheck = await checkRegistryAgentSupport({
    installDir: targetInstallDir,
  });
  if (!agentCheck.supported) {
    showCursorAgentNotSupportedError();
    return { success: false };
  }

  // Use config from agentCheck (already loaded during support check)
  const config = agentCheck.config;

  const profilesDir = getNoriProfilesDir({ installDir: targetInstallDir });
  // For namespaced packages, the profile is in a nested directory (e.g., profiles/myorg/my-profile)
  const targetDir =
    orgId === "public"
      ? path.join(profilesDir, packageName)
      : path.join(profilesDir, orgId, packageName);

  // Check if profile already exists and get its version info
  let existingVersionInfo: VersionInfo | null = null;
  let profileExists = false;
  try {
    await fs.access(targetDir);
    profileExists = true;
    existingVersionInfo = await readVersionInfo({ dir: targetDir });
  } catch {
    // Directory doesn't exist - continue
  }

  // Search for the package
  let searchResults: Array<RegistrySearchResult>;

  // Check if using unified auth with organizations (new flow)
  const hasUnifiedAuthWithOrgs =
    config?.auth != null &&
    config.auth.refreshToken != null &&
    config.auth.organizations != null;

  if (registryUrl != null) {
    // User specified a specific registry
    // Check if private registry requires auth (not public org registries)
    const publicRegistryUrl = buildOrganizationRegistryUrl({ orgId: "public" });
    if (registryUrl !== REGISTRAR_URL && registryUrl !== publicRegistryUrl) {
      // Check unified auth first
      let hasAuth = false;
      if (hasUnifiedAuthWithOrgs) {
        // Check if any org registry matches
        const userOrgs = config.auth!.organizations!;
        for (const userOrgId of userOrgs) {
          const orgRegistryUrl = buildOrganizationRegistryUrl({
            orgId: userOrgId,
          });
          if (orgRegistryUrl === registryUrl) {
            hasAuth = true;
            break;
          }
        }
      }
      // Fall back to legacy registryAuths
      if (!hasAuth) {
        const registryAuth =
          config != null ? getRegistryAuth({ config, registryUrl }) : null;
        if (registryAuth == null) {
          error({
            message: `No authentication configured for registry: ${registryUrl}\n\nAdd registry credentials to your .nori-config.json file.`,
          });
          return { success: false };
        }
      }
    }

    const result = await searchSpecificRegistry({
      packageName,
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
      const displayName =
        orgId === "public" ? packageName : `${orgId}/${packageName}`;
      error({
        message: `You do not have access to organization "${orgId}".\n\nCannot download "${displayName}" from ${targetRegistryUrl}.\n\nYour available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
      });
      return { success: false };
    }

    // Get auth token for the org registry
    const registryAuth = {
      registryUrl: targetRegistryUrl,
      username: config.auth!.username,
      refreshToken: config.auth!.refreshToken,
    };

    try {
      const authToken = await getRegistryAuthToken({ registryAuth });
      const packument = await registrarApi.getPackument({
        packageName,
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
      // Package not found in org registry
      searchResults = [];
    }
  } else {
    // Legacy flow: Search all registries
    searchResults = await searchAllRegistries({ packageName, config });
  }

  // Handle search results
  if (searchResults.length === 0) {
    error({
      message: `Profile "${profileDisplayName}" not found in any registry.`,
    });
    return { success: false };
  }

  if (searchResults.length > 1) {
    error({
      message: formatMultiplePackagesError({
        packageName,
        results: searchResults,
        cliName,
      }),
    });
    return { success: false };
  }

  // Single result - download from that registry
  const selectedRegistry = searchResults[0];

  // If --list-versions flag is set, show versions and exit
  if (listVersions) {
    raw({
      message: formatVersionList({
        packageName,
        packument: selectedRegistry.packument,
        registryUrl: selectedRegistry.registryUrl,
        cliName,
      }),
    });
    return { success: true };
  }

  // Determine the target version
  const targetVersion =
    version ?? selectedRegistry.packument["dist-tags"].latest;

  // If profile already exists, check version
  if (profileExists) {
    if (existingVersionInfo == null) {
      // Profile exists but has no .nori-version - manual install
      error({
        message: `Profile "${packageName}" already exists at:\n${targetDir}\n\nThis profile has no version information (.nori-version file).\nIt may have been installed manually or with an older version of Nori.\n\nTo reinstall:\n  rm -rf "${targetDir}"\n  ${cliPrefix} ${commandNames.download} ${packageName}`,
      });
      return { success: false };
    }

    const installedVersion = existingVersionInfo.version;

    // Compare versions
    const installedValid = semver.valid(installedVersion) != null;
    const targetValid = semver.valid(targetVersion) != null;

    if (installedValid && targetValid) {
      if (semver.gte(installedVersion, targetVersion)) {
        // Already at same or newer version - still check skill dependencies
        const noriJson = await readNoriJson({ profileDir: targetDir });
        if (noriJson != null) {
          const profileSkillsDir = path.join(targetDir, "skills");
          await downloadSkillDependencies({
            noriJson,
            skillsDir: profileSkillsDir,
            registryUrl: selectedRegistry.registryUrl,
            authToken: selectedRegistry.authToken,
          });
        }

        if (installedVersion === targetVersion) {
          success({
            message: `Profile "${packageName}" is already at version ${installedVersion}.`,
          });
        } else {
          success({
            message: `Profile "${packageName}" is already at version ${installedVersion} (requested ${targetVersion}).`,
          });
        }
        return { success: true };
      }
      // Newer version available - will proceed to update
      info({
        message: `Updating profile "${packageName}" from ${installedVersion} to ${targetVersion}...`,
      });
    } else if (installedVersion === targetVersion) {
      // Fallback for non-semver versions - still check skill dependencies
      const noriJson = await readNoriJson({ profileDir: targetDir });
      if (noriJson != null) {
        const profileSkillsDir = path.join(targetDir, "skills");
        await downloadSkillDependencies({
          noriJson,
          skillsDir: profileSkillsDir,
          registryUrl: selectedRegistry.registryUrl,
          authToken: selectedRegistry.authToken,
        });
      }

      success({
        message: `Profile "${packageName}" is already at version ${installedVersion}.`,
      });
      return { success: true };
    }
  }

  // Download and extract the tarball
  try {
    if (!profileExists) {
      info({ message: `Downloading profile "${profileDisplayName}"...` });
    }

    const tarballData = await registrarApi.downloadTarball({
      packageName,
      version: version ?? undefined,
      registryUrl: selectedRegistry.registryUrl,
      authToken: selectedRegistry.authToken ?? undefined,
    });

    if (profileExists) {
      // Update existing profile - extract to temp dir first
      const tempDir = path.join(profilesDir, `.${packageName}-download-temp`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        await extractTarball({ tarballData, targetDir: tempDir });
      } catch (extractErr) {
        // Clean up temp directory on extraction failure
        await fs.rm(tempDir, { recursive: true, force: true });
        throw extractErr;
      }

      // Extraction succeeded - now safely remove existing profile contents
      // Preserve .nori-version and skills/ directory (downloaded skill dependencies)
      const existingFiles = await fs.readdir(targetDir);
      for (const file of existingFiles) {
        if (file !== ".nori-version" && file !== "skills") {
          await fs.rm(path.join(targetDir, file), {
            recursive: true,
            force: true,
          });
        }
      }

      // Move extracted files from temp to profile directory
      // Skip skills directory - it's managed separately via downloadSkillDependencies
      const extractedFiles = await fs.readdir(tempDir);
      for (const file of extractedFiles) {
        if (file === "skills") {
          // Don't overwrite existing skills - remove extracted skills from temp
          await fs.rm(path.join(tempDir, file), {
            recursive: true,
            force: true,
          });
          continue;
        }
        await fs.rename(path.join(tempDir, file), path.join(targetDir, file));
      }

      // Remove temp directory
      await fs.rm(tempDir, { recursive: true, force: true });
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

    // Check for nori.json and download skill dependencies
    const noriJson = await readNoriJson({ profileDir: targetDir });
    if (noriJson != null) {
      // Skills are downloaded to the PROFILE's skills directory, not a global path
      const profileSkillsDir = path.join(targetDir, "skills");
      await downloadSkillDependencies({
        noriJson,
        skillsDir: profileSkillsDir,
        registryUrl: selectedRegistry.registryUrl,
        authToken: selectedRegistry.authToken,
      });
    }

    const versionStr = version ? `@${version}` : " (latest)";
    newline();
    if (profileExists) {
      success({
        message: `Updated profile "${profileDisplayName}" to ${targetVersion}`,
      });
    } else {
      success({
        message: `Downloaded and installed profile "${profileDisplayName}"${versionStr}`,
      });
    }
    info({ message: `Installed to: ${targetDir}` });
    newline();
    info({
      message: `You can now use this profile with '${cliPrefix} ${commandNames.switchProfile} ${profileDisplayName}'.`,
    });

    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error({
      message: `Failed to download profile "${profileDisplayName}": ${errorMessage}`,
    });
    return { success: false };
  }
};

/**
 * Register the 'registry-download' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerRegistryDownloadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("registry-download <package>")
    .description(
      "Download and install a profile package from the Nori registrar",
    )
    .option(
      "--registry <url>",
      "Download from a specific registry URL instead of searching all registries",
    )
    .option(
      "--list-versions",
      "List available versions for the package instead of downloading",
    )
    .action(
      async (
        packageSpec: string,
        options: { registry?: string; listVersions?: boolean },
      ) => {
        const globalOpts = program.opts();

        const result = await registryDownloadMain({
          packageSpec,
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
        });

        if (!result.success) {
          process.exit(1);
        }
      },
    );
};
