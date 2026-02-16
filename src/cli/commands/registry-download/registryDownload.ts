/**
 * CLI command for downloading profile packages from the Nori registrar
 * Handles: nori-skillsets download <package>[@version] [--registry <url>]
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
  NetworkError,
  type Packument,
} from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import { initMain } from "@/cli/commands/init/init.js";
import { getRegistryAuth, loadConfig } from "@/cli/config.js";
import { getNoriProfilesDir } from "@/cli/features/claude-code/paths.js";
import { error, info } from "@/cli/logger.js";
import { registryDownloadFlow } from "@/cli/prompts/flows/index.js";
import { getInstallDirs } from "@/utils/path.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { Config } from "@/cli/config.js";
import type {
  DownloadSearchResult,
  DownloadActionResult,
} from "@/cli/prompts/flows/index.js";
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
 * Result of downloading a single skill dependency
 */
type SkillDependencyResult = {
  downloaded: boolean;
  warning?: string | null;
};

/**
 * Download and install a single skill dependency (always uses latest version)
 * @param args - The download parameters
 * @param args.skillName - The name of the skill to download
 * @param args.skillsDir - The directory where skills are installed
 * @param args.registryUrl - The registry URL to download from
 * @param args.authToken - Optional authentication token for private registries
 * @param args.silent - If true, collect warnings as return values instead of logging
 *
 * @returns Result indicating whether the skill was downloaded and any warning
 */
const downloadSkillDependency = async (args: {
  skillName: string;
  skillsDir: string;
  registryUrl: string;
  authToken?: string | null;
  silent?: boolean | null;
}): Promise<SkillDependencyResult> => {
  const { skillName, skillsDir, registryUrl, authToken, silent } = args;
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
      const warning = `Warning: No latest version found for skill "${skillName}"`;
      if (!silent) {
        info({ message: warning });
      }
      return { downloaded: false, warning };
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
          return { downloaded: false }; // Already installed with latest version
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

    return { downloaded: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const warning = `Warning: Failed to download skill "${skillName}": ${errorMessage}`;
    if (!silent) {
      info({ message: warning });
    }
    return { downloaded: false, warning };
  }
};

/**
 * Download all skill dependencies from a nori.json (always uses latest versions)
 * @param args - The download parameters
 * @param args.noriJson - The parsed nori.json manifest containing dependencies
 * @param args.skillsDir - The directory where skills are installed
 * @param args.registryUrl - The registry URL to download from
 * @param args.authToken - Optional authentication token for private registries
 * @param args.silent - If true, suppress log output and return warnings instead
 *
 * @returns Array of warning messages from failed dependency downloads
 */
const downloadSkillDependencies = async (args: {
  noriJson: NoriJson;
  skillsDir: string;
  registryUrl: string;
  authToken?: string | null;
  silent?: boolean | null;
}): Promise<Array<string>> => {
  const { noriJson, skillsDir, registryUrl, authToken, silent } = args;

  const skillDeps = noriJson.dependencies?.skills;
  if (skillDeps == null || Object.keys(skillDeps).length === 0) {
    return [];
  }

  if (!silent) {
    info({ message: "Installing skill dependencies..." });
  }

  const warnings: Array<string> = [];
  for (const skillName of Object.keys(skillDeps)) {
    const result = await downloadSkillDependency({
      skillName,
      skillsDir,
      registryUrl,
      authToken,
      silent,
    });
    if (result.warning != null) {
      warnings.push(result.warning);
    }
  }
  return warnings;
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
 * Error information from a failed search
 */
type SearchError = {
  registryUrl: string;
  isNetworkError: boolean;
  message: string;
};

/**
 * Search a specific registry for a package
 * @param args - The search parameters
 * @param args.packageName - The package name to search for
 * @param args.registryUrl - The registry URL to search
 * @param args.config - The Nori configuration containing registry auth
 *
 * @returns Object with result (if found) and/or error (if failed)
 */
const searchSpecificRegistry = async (args: {
  packageName: string;
  registryUrl: string;
  config: Config | null;
}): Promise<{
  result: RegistrySearchResult | null;
  error: SearchError | null;
}> => {
  const { packageName, registryUrl, config } = args;

  // Check if this is the public registry
  if (registryUrl === REGISTRAR_URL) {
    try {
      const packument = await registrarApi.getPackument({
        packageName,
        registryUrl: REGISTRAR_URL,
      });
      return {
        result: {
          registryUrl: REGISTRAR_URL,
          packument,
        },
        error: null,
      };
    } catch (err) {
      if (err instanceof NetworkError) {
        return {
          result: null,
          error: {
            registryUrl: REGISTRAR_URL,
            isNetworkError: true,
            message: err.message,
          },
        };
      }
      // API error (like 404) - package not found
      return { result: null, error: null };
    }
  }

  // Private registry - require auth from config
  if (config == null) {
    return { result: null, error: null };
  }

  const registryAuth = getRegistryAuth({ config, registryUrl });
  if (registryAuth == null) {
    return { result: null, error: null };
  }

  try {
    const authToken = await getRegistryAuthToken({ registryAuth });
    const packument = await registrarApi.getPackument({
      packageName,
      registryUrl,
      authToken,
    });
    return {
      result: {
        registryUrl,
        packument,
        authToken,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof NetworkError) {
      return {
        result: null,
        error: {
          registryUrl,
          isNetworkError: true,
          message: err.message,
        },
      };
    }
    // API error (like 404) - package not found
    return { result: null, error: null };
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

  const cliPrefix = cliName ?? "nori-skillsets";
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
  const cliPrefix = cliName ?? "nori-skillsets";

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
 * @param args.cliName - CLI name for user-facing messages (defaults to nori-skillsets)
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
  const cliPrefix = cliName ?? "nori-skillsets";

  // Parse the namespaced package spec (e.g., "myorg/my-profile@1.0.0")
  const parsed = parseNamespacedPackage({ packageSpec });
  if (parsed == null) {
    error({
      message: `Invalid package specification: "${packageSpec}".\nExpected format: skillset-name or org/skillset-name[@version]`,
    });
    return { success: false };
  }
  const { orgId, packageName, version } = parsed;
  // Display name includes org prefix for namespaced packages (e.g., "myorg/my-profile")
  const profileDisplayName =
    orgId === "public" ? packageName : `${orgId}/${packageName}`;

  // Find installation directory and auto-init if needed
  if (installDir != null) {
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

    // Check home directory for existing installation
    const homeDir = os.homedir();
    const homeInstallations = getInstallDirs({ currentDir: homeDir });

    if (!homeInstallations.includes(homeDir)) {
      if (allInstallations.length === 0) {
        // No installation found - auto-init at home directory (interactive to allow user prompts)
        // Skip the profile persistence warning since users are just trying to download a profile
        info({ message: "Setting up Nori for first time use..." });
        try {
          await initMain({
            installDir: homeDir,
            nonInteractive: false,
            skipWarning: true,
          });
        } catch (err) {
          error({
            message: `Failed to initialize Nori: ${err instanceof Error ? err.message : String(err)}`,
          });
          return { success: false };
        }
      } else if (allInstallations.length > 1) {
        const installList = allInstallations
          .map((dir, index) => `${index + 1}. ${dir}`)
          .join("\n");

        error({
          message: `Found multiple Nori installations. Cannot determine which one to use.\n\nInstallations found:\n${installList}\n\nPlease use --install-dir to specify the target installation.`,
        });
        return { success: false };
      }
    }
  }

  // Load config for registry auth - use os.homedir() since registry needs global auth
  const config = await loadConfig({ startDir: os.homedir() });

  const profilesDir = getNoriProfilesDir();
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

  // Closure variable shared between onSearch and onDownload callbacks
  let foundRegistry: RegistrySearchResult | null = null;
  let resolvedTargetVersion = "";

  const result = await registryDownloadFlow({
    packageDisplayName: profileDisplayName,
    callbacks: {
      onSearch: async (): Promise<DownloadSearchResult> => {
        // Inline search logic
        let flowSearchResults: Array<RegistrySearchResult>;

        const hasUnifiedAuth =
          config?.auth != null &&
          config.auth.refreshToken != null &&
          config.auth.organizations != null;

        if (registryUrl != null) {
          const publicRegistryUrl = buildOrganizationRegistryUrl({
            orgId: "public",
          });
          if (
            registryUrl !== REGISTRAR_URL &&
            registryUrl !== publicRegistryUrl
          ) {
            let hasAuth = false;
            if (hasUnifiedAuth) {
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
            if (!hasAuth) {
              const registryAuth =
                config != null
                  ? getRegistryAuth({ config, registryUrl })
                  : null;
              if (registryAuth == null) {
                return {
                  status: "error",
                  error: `No authentication configured for registry: ${registryUrl}`,
                  hint: "Add registry credentials to your .nori-config.json file.",
                };
              }
            }
          }

          const { result: searchResult, error: searchError } =
            await searchSpecificRegistry({
              packageName,
              registryUrl,
              config,
            });
          if (searchError?.isNetworkError) {
            return {
              status: "error",
              error: `Network error while connecting to ${registryUrl}:\n\n${searchError.message}`,
            };
          }
          flowSearchResults = searchResult != null ? [searchResult] : [];
        } else if (hasUnifiedAuth) {
          const targetRegistryUrl = buildOrganizationRegistryUrl({ orgId });
          const userOrgs = config.auth!.organizations!;

          if (!userOrgs.includes(orgId)) {
            return {
              status: "error",
              error: `You do not have access to organization "${orgId}".`,
              hint: `Your available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
            };
          }

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
            flowSearchResults = [
              { registryUrl: targetRegistryUrl, packument, authToken },
            ];
          } catch (err) {
            if (err instanceof NetworkError) {
              return {
                status: "error",
                error: `Network error while connecting to ${targetRegistryUrl}:\n\n${err.message}`,
              };
            }
            flowSearchResults = [];
          }
        } else if (orgId === "public") {
          try {
            const packument = await registrarApi.getPackument({
              packageName,
              registryUrl: REGISTRAR_URL,
            });
            flowSearchResults = [{ registryUrl: REGISTRAR_URL, packument }];
          } catch (err) {
            if (err instanceof NetworkError) {
              return {
                status: "error",
                error: `Network error while connecting to registry:\n\n${err.message}`,
              };
            }
            flowSearchResults = [];
          }
        } else {
          return {
            status: "error",
            error: `Skillset "${orgId}/${packageName}" not found.`,
            hint: `To download from organization "${orgId}", log in with:\n  nori-skillsets login`,
          };
        }

        if (flowSearchResults.length === 0) {
          return {
            status: "error",
            error: `Skillset "${profileDisplayName}" not found in any registry.`,
          };
        }

        if (flowSearchResults.length > 1) {
          return {
            status: "error",
            error: formatMultiplePackagesError({
              packageName,
              results: flowSearchResults,
              cliName,
            }),
          };
        }

        foundRegistry = flowSearchResults[0];

        if (listVersions) {
          return {
            status: "list-versions",
            formattedVersionList: formatVersionList({
              packageName,
              packument: foundRegistry.packument,
              registryUrl: foundRegistry.registryUrl,
              cliName,
            }),
            versionCount: Object.keys(foundRegistry.packument.versions).length,
          };
        }

        resolvedTargetVersion =
          version ?? foundRegistry.packument["dist-tags"].latest;

        if (profileExists && existingVersionInfo != null) {
          const installedVersion = existingVersionInfo.version;
          const installedValid = semver.valid(installedVersion) != null;
          const targetValid = semver.valid(resolvedTargetVersion) != null;

          if (installedValid && targetValid) {
            if (semver.gte(installedVersion, resolvedTargetVersion)) {
              let depWarnings: Array<string> = [];
              const noriJson = await readNoriJson({ profileDir: targetDir });
              if (noriJson != null) {
                const profileSkillsDir = path.join(targetDir, "skills");
                depWarnings = await downloadSkillDependencies({
                  noriJson,
                  skillsDir: profileSkillsDir,
                  registryUrl: foundRegistry.registryUrl,
                  authToken: foundRegistry.authToken,
                  silent: true,
                });
              }
              return {
                status: "already-current",
                version: installedVersion,
                warnings: depWarnings,
              };
            }
            return {
              status: "ready",
              targetVersion: resolvedTargetVersion,
              isUpdate: true,
              currentVersion: installedVersion,
            };
          } else if (installedVersion === resolvedTargetVersion) {
            let depWarnings: Array<string> = [];
            const noriJson = await readNoriJson({ profileDir: targetDir });
            if (noriJson != null) {
              const profileSkillsDir = path.join(targetDir, "skills");
              depWarnings = await downloadSkillDependencies({
                noriJson,
                skillsDir: profileSkillsDir,
                registryUrl: foundRegistry.registryUrl,
                authToken: foundRegistry.authToken,
                silent: true,
              });
            }
            return {
              status: "already-current",
              version: installedVersion,
              warnings: depWarnings,
            };
          }
        }

        if (profileExists && existingVersionInfo == null) {
          return {
            status: "error",
            error: `Skillset "${packageName}" already exists at:\n${targetDir}\n\nThis skillset has no version information (.nori-version file).`,
            hint: `To reinstall:\n  rm -rf "${targetDir}"\n  ${cliPrefix} ${commandNames.download} ${packageName}`,
          };
        }

        return {
          status: "ready",
          targetVersion: resolvedTargetVersion,
          isUpdate: false,
        };
      },
      onDownload: async (): Promise<DownloadActionResult> => {
        const selectedRegistry = foundRegistry!;

        try {
          const tarballData = await registrarApi.downloadTarball({
            packageName,
            version: version ?? undefined,
            registryUrl: selectedRegistry.registryUrl,
            authToken: selectedRegistry.authToken ?? undefined,
          });

          if (profileExists) {
            const tempDir = path.join(
              profilesDir,
              `.${packageName}-download-temp`,
            );
            await fs.mkdir(tempDir, { recursive: true });

            try {
              await extractTarball({ tarballData, targetDir: tempDir });
            } catch (extractErr) {
              await fs.rm(tempDir, { recursive: true, force: true });
              throw extractErr;
            }

            const existingFiles = await fs.readdir(targetDir);
            for (const file of existingFiles) {
              if (file !== ".nori-version" && file !== "skills") {
                await fs.rm(path.join(targetDir, file), {
                  recursive: true,
                  force: true,
                });
              }
            }

            const extractedFiles = await fs.readdir(tempDir);
            for (const file of extractedFiles) {
              if (file === "skills") {
                await fs.rm(path.join(tempDir, file), {
                  recursive: true,
                  force: true,
                });
                continue;
              }
              await fs.rename(
                path.join(tempDir, file),
                path.join(targetDir, file),
              );
            }

            await fs.rm(tempDir, { recursive: true, force: true });
          } else {
            await fs.mkdir(targetDir, { recursive: true });

            try {
              await extractTarball({ tarballData, targetDir });
            } catch (extractErr) {
              await fs.rm(targetDir, { recursive: true, force: true });
              throw extractErr;
            }
          }

          await fs.writeFile(
            path.join(targetDir, ".nori-version"),
            JSON.stringify(
              {
                version: resolvedTargetVersion,
                registryUrl: selectedRegistry.registryUrl,
              },
              null,
              2,
            ),
          );

          // Download skill dependencies and collect warnings
          let warnings: Array<string> = [];
          const noriJson = await readNoriJson({ profileDir: targetDir });
          if (noriJson != null) {
            const profileSkillsDir = path.join(targetDir, "skills");
            warnings = await downloadSkillDependencies({
              noriJson,
              skillsDir: profileSkillsDir,
              registryUrl: selectedRegistry.registryUrl,
              authToken: selectedRegistry.authToken,
              silent: true,
            });
          }

          return {
            success: true,
            version: resolvedTargetVersion,
            isUpdate: profileExists,
            installedTo: targetDir,
            switchHint: `${cliPrefix} ${commandNames.switchProfile} ${profileDisplayName}`,
            profileDisplayName,
            warnings,
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: `Failed to download skillset "${profileDisplayName}": ${errorMessage}`,
          };
        }
      },
    },
  });
  return { success: result != null };
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
      "Download and install a skillset package from the Nori registrar",
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
