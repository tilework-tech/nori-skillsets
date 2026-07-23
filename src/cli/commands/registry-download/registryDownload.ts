/**
 * CLI command for downloading skillset packages from the Nori registrar
 * Handles: nori-skillsets download <package>[@version] [--registry <url>]
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import * as semver from "semver";

import { hasRegistryAuthCredentials } from "@/api/authCredentials.js";
import { registrarApi, REGISTRAR_URL, NetworkError } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import { initMain } from "@/cli/commands/init/init.js";
import { getRegistryAuth, loadConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import { registryDownloadFlow } from "@/cli/prompts/flows/index.js";
import { recordFlowFailure } from "@/cli/prompts/flows/utils.js";
import { resolveOrgRegistryAuth } from "@/core/registryAuthResolution.js";
import { skillsetPath } from "@/norijson/skillset.js";
import { verifyArchiveChecksum } from "@/packaging/archive.js";
import {
  atomicReplaceDirWithArchive,
  extractArchiveToNewDir,
  replaceDirContentsWithArchive,
} from "@/packaging/atomicReplace.js";
import { readVersionInfo, writeVersionInfo } from "@/packaging/provenance.js";
import {
  formatMultipleMatchesError,
  formatVersionList,
  searchSpecificRegistry,
} from "@/packaging/registryLookup.js";
import { resolveInstallDir } from "@/utils/path.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
  extractOrgId,
  namespacedName,
  formatDefaultOrgNotice,
} from "@/utils/url.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type {
  DownloadSearchResult,
  DownloadActionResult,
} from "@/cli/prompts/flows/index.js";
import type { NoriJson } from "@/norijson/nori.js";
import type { VersionInfo } from "@/packaging/provenance.js";
import type { RegistrySearchResult } from "@/packaging/registryLookup.js";
import type { Command } from "commander";

/**
 * Read the nori.json file from a skillset directory
 * @param args - The function arguments
 * @param args.skillsetDir - The skillset directory path
 *
 * @returns The nori.json content or null if not found
 */
const readNoriJson = async (args: {
  skillsetDir: string;
}): Promise<NoriJson | null> => {
  const { skillsetDir } = args;
  const noriJsonPath = path.join(skillsetDir, "nori.json");

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
        log.warn(warning);
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
    verifyArchiveChecksum({
      tarballData,
      expectedShasum: packument.versions[latestVersion]?.dist?.shasum,
    });

    // Extract to skill directory
    if (skillExists) {
      await atomicReplaceDirWithArchive({ tarballData, targetDir: skillDir });
    } else {
      await extractArchiveToNewDir({ tarballData, targetDir: skillDir });
    }

    await writeVersionInfo({
      dir: skillDir,
      versionInfo: { version: latestVersion, registryUrl },
    });

    return { downloaded: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const warning = `Warning: Failed to download skill "${skillName}": ${errorMessage}`;
    if (!silent) {
      log.warn(warning);
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
    log.info("Installing skill dependencies...");
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
 * Result of downloading a single subagent dependency
 */
type SubagentDependencyResult = {
  downloaded: boolean;
  warning?: string | null;
};

/**
 * Download and install a single subagent dependency (always uses latest version)
 * @param args - The download parameters
 * @param args.subagentName - The name of the subagent to download
 * @param args.subagentsDir - The directory where subagents are installed
 * @param args.registryUrl - The registry URL to download from
 * @param args.authToken - Optional authentication token for private registries
 * @param args.silent - If true, collect warnings as return values instead of logging
 *
 * @returns Result indicating whether the subagent was downloaded and any warning
 */
const downloadSubagentDependency = async (args: {
  subagentName: string;
  subagentsDir: string;
  registryUrl: string;
  authToken?: string | null;
  silent?: boolean | null;
}): Promise<SubagentDependencyResult> => {
  const { subagentName, subagentsDir, registryUrl, authToken, silent } = args;
  const subagentDir = path.join(subagentsDir, subagentName);

  try {
    // Fetch subagent packument to get latest version
    const packument = await registrarApi.getSubagentPackument({
      subagentName,
      registryUrl,
      authToken: authToken ?? undefined,
    });

    const latestVersion = packument["dist-tags"].latest;
    if (latestVersion == null) {
      const warning = `Warning: No latest version found for subagent "${subagentName}"`;
      if (!silent) {
        log.warn(warning);
      }
      return { downloaded: false, warning };
    }

    // Check if subagent already exists with same version
    let subagentExists = false;
    try {
      await fs.access(subagentDir);
      subagentExists = true;
    } catch {
      // Subagent doesn't exist
    }

    if (subagentExists) {
      const existingVersionInfo = await readVersionInfo({ dir: subagentDir });
      if (existingVersionInfo != null) {
        // Skip if already at latest version
        if (existingVersionInfo.version === latestVersion) {
          return { downloaded: false }; // Already installed with latest version
        }
      }
    }

    // Download the subagent tarball (latest version)
    const tarballData = await registrarApi.downloadSubagentTarball({
      subagentName,
      version: latestVersion,
      registryUrl,
      authToken: authToken ?? undefined,
    });
    verifyArchiveChecksum({
      tarballData,
      expectedShasum: packument.versions[latestVersion]?.dist?.shasum,
    });

    // Extract to subagent directory
    if (subagentExists) {
      await atomicReplaceDirWithArchive({
        tarballData,
        targetDir: subagentDir,
      });
    } else {
      await extractArchiveToNewDir({ tarballData, targetDir: subagentDir });
    }

    await writeVersionInfo({
      dir: subagentDir,
      versionInfo: { version: latestVersion, registryUrl },
    });

    return { downloaded: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const warning = `Warning: Failed to download subagent "${subagentName}": ${errorMessage}`;
    if (!silent) {
      log.warn(warning);
    }
    return { downloaded: false, warning };
  }
};

/**
 * Download all subagent dependencies from a nori.json (always uses latest versions)
 * @param args - The download parameters
 * @param args.noriJson - The parsed nori.json manifest containing dependencies
 * @param args.subagentsDir - The directory where subagents are installed
 * @param args.registryUrl - The registry URL to download from
 * @param args.authToken - Optional authentication token for private registries
 * @param args.silent - If true, suppress log output and return warnings instead
 *
 * @returns Array of warning messages from failed dependency downloads
 */
const downloadSubagentDependencies = async (args: {
  noriJson: NoriJson;
  subagentsDir: string;
  registryUrl: string;
  authToken?: string | null;
  silent?: boolean | null;
}): Promise<Array<string>> => {
  const { noriJson, subagentsDir, registryUrl, authToken, silent } = args;

  const subagentDeps = noriJson.dependencies?.subagents;
  if (subagentDeps == null || Object.keys(subagentDeps).length === 0) {
    return [];
  }

  if (!silent) {
    log.info("Installing subagent dependencies...");
  }

  const warnings: Array<string> = [];
  for (const subagentName of Object.keys(subagentDeps)) {
    const result = await downloadSubagentDependency({
      subagentName,
      subagentsDir,
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
 * Download and install a skillset from the registrar
 * @param args - The download parameters
 * @param args.packageSpec - Package name with optional version (e.g., "my-profile" or "my-profile@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL to download from
 * @param args.listVersions - If true, list available versions instead of downloading
 * @param args.cliName - CLI name for user-facing messages (defaults to nori-skillsets)
 * @param args.nonInteractive - If true, skip interactive prompts and use defaults
 * @param args.silent - If true, suppress output (implies nonInteractive)
 *
 * @returns Result indicating success or failure
 */
type RegistryDownloadArgs = {
  packageSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
  cliName?: CliName | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

const registryDownloadMainImpl = async (
  args: RegistryDownloadArgs,
): Promise<CommandStatus> => {
  const {
    packageSpec,
    installDir,
    registryUrl,
    listVersions,
    cliName,
    nonInteractive,
    silent,
  } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";

  // Load config first so a bare name can resolve against the configured
  // default org. An explicit --registry overrides that resolution.
  const config = await loadConfig();

  // Parse the namespaced package spec (e.g., "myorg/my-profile@1.0.0")
  const parsed = parseNamespacedPackage({
    packageSpec,
    defaultOrg: registryUrl == null ? config?.defaultOrg : null,
  });
  if (parsed == null) {
    log.error(
      `Invalid package specification: "${packageSpec}".\nExpected format: skillset-name or org/skillset-name[@version]`,
    );
    return {
      success: false,
      cancelled: false,
      message: `Invalid package specification: "${packageSpec}"`,
    };
  }
  const { orgId, packageName, version } = parsed;
  const profileDisplayName = namespacedName({ orgId, packageName });

  const defaultOrgNotice = formatDefaultOrgNotice({
    packageSpec,
    orgId,
    packageName,
  });
  if (defaultOrgNotice != null && silent !== true) {
    log.info(defaultOrgNotice);
  }

  // Resolve install directory from config and auto-init if needed
  const resolvedInstallDir = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  }).path;

  // Auto-init if no config exists yet (first time use)
  if (config == null) {
    log.info("Setting up Nori for first time use...");
    try {
      await initMain({
        captureExisting: false,
        installDir: resolvedInstallDir,
        markInstalled: false,
        nonInteractive: nonInteractive ?? silent ?? false,
        skipWarning: true,
      });
    } catch (err) {
      log.error(
        `Failed to initialize Nori: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        success: false,
        cancelled: false,
        message: `Failed to initialize Nori: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Downloaded packages are stored under their bucket/namespace on disk:
  // public packages in profiles/public/<name>, org packages in profiles/<org>/<name>.
  const targetDir = skillsetPath({
    name: namespacedName({ orgId, packageName }),
  });

  // Check if skillset already exists and get its version info
  let existingVersionInfo: VersionInfo | null = null;
  let profileExists = false;
  try {
    await fs.access(targetDir);
    profileExists = true;
    existingVersionInfo = await readVersionInfo({ dir: targetDir });
  } catch {
    // Directory doesn't exist - continue
  }

  // Closure variables shared between onSearch and onDownload callbacks
  let foundRegistry: RegistrySearchResult | null = null;
  let resolvedTargetVersion = "";
  // The flow resolves to null for BOTH a user cancel and a callback-reported
  // failure; record failures so real errors are not mistaken for a cancel.
  let flowError: string | null = null;

  const result = await registryDownloadFlow({
    packageDisplayName: profileDisplayName,
    nonInteractive: nonInteractive ?? silent ?? null,
    callbacks: {
      onSearch: recordFlowFailure({
        onFailure: (error) => {
          flowError = error;
        },
        fn: async (): Promise<DownloadSearchResult> => {
          // Inline search logic
          let flowSearchResults: Array<RegistrySearchResult>;

          const hasUnifiedAuth =
            config?.auth != null &&
            hasRegistryAuthCredentials({ auth: config.auth }) &&
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

            // Resolve the token for this explicit registry. Prefer unified org
            // auth (membership in config.auth.organizations) when the URL is an
            // org registry the user belongs to; this mirrors the derived-registry
            // path and authenticates org members whose home org differs from the
            // target org. Fall back to getRegistryAuth for the home org and
            // local dev.
            let getAuthToken: (() => Promise<string>) | null = null;
            const registryOrgId = extractOrgId({ url: registryUrl });
            if (
              hasUnifiedAuth &&
              registryOrgId != null &&
              registryOrgId !== "public"
            ) {
              const orgResolution = resolveOrgRegistryAuth({
                auth: config?.auth ?? null,
                orgId: registryOrgId,
              });
              if (
                orgResolution.ok &&
                orgResolution.registryUrl === registryUrl
              ) {
                getAuthToken = orgResolution.getToken;
              }
            }
            if (getAuthToken == null) {
              const searchRegistryAuth =
                config != null
                  ? getRegistryAuth({ config, registryUrl })
                  : null;
              getAuthToken =
                searchRegistryAuth != null
                  ? () =>
                      getRegistryAuthToken({ registryAuth: searchRegistryAuth })
                  : null;
            }
            const { result: searchResult, error: searchError } =
              await searchSpecificRegistry({
                registryUrl,
                fetchPackument: (fetchArgs) =>
                  registrarApi.getPackument({ packageName, ...fetchArgs }),
                getAuthToken,
              });
            if (searchError?.isNetworkError) {
              return {
                status: "error",
                error: `Network error while connecting to ${registryUrl}:\n\n${searchError.message}`,
              };
            }
            flowSearchResults = searchResult != null ? [searchResult] : [];
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
          } else if (hasUnifiedAuth) {
            const resolution = resolveOrgRegistryAuth({
              auth: config?.auth ?? null,
              orgId,
            });

            if (resolution.ok === false) {
              const userOrgs =
                resolution.reason === "not-a-member"
                  ? resolution.organizations
                  : [];
              return {
                status: "error",
                error: `You do not have access to organization "${orgId}".`,
                hint: `Your available organizations: ${userOrgs.length > 0 ? userOrgs.join(", ") : "(none)"}`,
              };
            }
            const targetRegistryUrl = resolution.registryUrl;

            try {
              const authToken = await resolution.getToken();
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
              error: formatMultipleMatchesError({
                packageName,
                results: flowSearchResults,
                entityLabel: "packages",
                downloadCommand: `${cliPrefix} ${commandNames.download}`,
              }),
            };
          }

          foundRegistry = flowSearchResults[0];

          if (listVersions) {
            return {
              status: "list-versions",
              formattedVersionList: formatVersionList({
                packageName: profileDisplayName,
                packument: foundRegistry.packument,
                registryUrl: foundRegistry.registryUrl,
                downloadCommand: `${cliPrefix} ${commandNames.download}`,
              }),
              versionCount: Object.keys(foundRegistry.packument.versions)
                .length,
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
                const noriJson = await readNoriJson({ skillsetDir: targetDir });
                if (noriJson != null) {
                  const profileSkillsDir = path.join(targetDir, "skills");
                  depWarnings = await downloadSkillDependencies({
                    noriJson,
                    skillsDir: profileSkillsDir,
                    registryUrl: foundRegistry.registryUrl,
                    authToken: foundRegistry.authToken,
                    silent: true,
                  });
                  const profileSubagentsDir = path.join(targetDir, "subagents");
                  const subagentWarnings = await downloadSubagentDependencies({
                    noriJson,
                    subagentsDir: profileSubagentsDir,
                    registryUrl: foundRegistry.registryUrl,
                    authToken: foundRegistry.authToken,
                    silent: true,
                  });
                  depWarnings = [...depWarnings, ...subagentWarnings];
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
              const noriJson = await readNoriJson({ skillsetDir: targetDir });
              if (noriJson != null) {
                const profileSkillsDir = path.join(targetDir, "skills");
                depWarnings = await downloadSkillDependencies({
                  noriJson,
                  skillsDir: profileSkillsDir,
                  registryUrl: foundRegistry.registryUrl,
                  authToken: foundRegistry.authToken,
                  silent: true,
                });
                const profileSubagentsDir = path.join(targetDir, "subagents");
                const subagentWarnings = await downloadSubagentDependencies({
                  noriJson,
                  subagentsDir: profileSubagentsDir,
                  registryUrl: foundRegistry.registryUrl,
                  authToken: foundRegistry.authToken,
                  silent: true,
                });
                depWarnings = [...depWarnings, ...subagentWarnings];
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
              error: `Skillset "${profileDisplayName}" already exists at:\n${targetDir}\n\nThis skillset has no version information (.nori-version file).`,
              hint: `To reinstall:\n  rm -rf "${targetDir}"\n  ${cliPrefix} ${commandNames.download} ${profileDisplayName}`,
            };
          }

          return {
            status: "ready",
            targetVersion: resolvedTargetVersion,
            isUpdate: false,
          };
        },
      }),
      onDownload: recordFlowFailure({
        onFailure: (error) => {
          flowError = error;
        },
        fn: async (): Promise<DownloadActionResult> => {
          const selectedRegistry = foundRegistry!;

          try {
            const tarballData = await registrarApi.downloadTarball({
              packageName,
              version: version ?? undefined,
              registryUrl: selectedRegistry.registryUrl,
              authToken: selectedRegistry.authToken ?? undefined,
            });
            verifyArchiveChecksum({
              tarballData,
              expectedShasum:
                selectedRegistry.packument.versions[resolvedTargetVersion]?.dist
                  ?.shasum,
            });

            if (profileExists) {
              await replaceDirContentsWithArchive({
                tarballData,
                targetDir,
                preserveEntries: [".nori-version", "skills", "subagents"],
              });
            } else {
              await extractArchiveToNewDir({ tarballData, targetDir });
            }

            await writeVersionInfo({
              dir: targetDir,
              versionInfo: {
                version: resolvedTargetVersion,
                registryUrl: selectedRegistry.registryUrl,
              },
            });

            // Download skill and subagent dependencies and collect warnings
            let warnings: Array<string> = [];
            const noriJson = await readNoriJson({ skillsetDir: targetDir });
            if (noriJson != null) {
              const profileSkillsDir = path.join(targetDir, "skills");
              warnings = await downloadSkillDependencies({
                noriJson,
                skillsDir: profileSkillsDir,
                registryUrl: selectedRegistry.registryUrl,
                authToken: selectedRegistry.authToken,
                silent: true,
              });

              const profileSubagentsDir = path.join(targetDir, "subagents");
              const subagentWarnings = await downloadSubagentDependencies({
                noriJson,
                subagentsDir: profileSubagentsDir,
                registryUrl: selectedRegistry.registryUrl,
                authToken: selectedRegistry.authToken,
                silent: true,
              });
              warnings = [...warnings, ...subagentWarnings];
            }

            return {
              success: true,
              version: resolvedTargetVersion,
              isUpdate: profileExists,
              installedTo: targetDir,
              switchHint: `${cliPrefix} ${commandNames.switchSkillset} ${profileDisplayName}`,
              profileDisplayName,
              warnings,
            };
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return {
              success: false,
              error: `Failed to download skillset "${profileDisplayName}": ${errorMessage}`,
            };
          }
        },
      }),
    },
  });
  if (result == null) {
    return {
      success: false,
      cancelled: flowError == null,
      message: flowError ?? "",
    };
  }

  return {
    success: true,
    cancelled: false,
    message: result.statusMessage,
  };
};

export const registryDownloadMain = async (
  args: RegistryDownloadArgs,
): Promise<CommandStatus> =>
  withInstallLock({ operation: () => registryDownloadMainImpl(args) });

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
          nonInteractive: globalOpts.nonInteractive || null,
          silent: globalOpts.silent || null,
        });

        if (!result.success) {
          process.exit(1);
        }
      },
    );
};
