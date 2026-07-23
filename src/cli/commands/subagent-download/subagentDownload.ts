/**
 * CLI command for downloading subagent packages from the Nori registrar
 * Handles: nori-skillsets download-subagent <subagent>[@version] [--registry <url>]
 *
 * Key difference from skill-download:
 * - Subagent tarballs extract to full directories in skillset profile (subagents/<name>/)
 * - Agent installation flattens: only SUBAGENT.md content → agents/<name>.md
 * - No skills.json manifest — only nori.json dependencies.subagents
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import * as semver from "semver";

import { hasRegistryAuthCredentials } from "@/api/authCredentials.js";
import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import {
  getRegistryAuth,
  getDefaultAgents,
  loadConfig,
  getActiveSkillset,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { withInstallLock } from "@/cli/features/install/installLock.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { subagentDownloadFlow } from "@/cli/prompts/flows/subagentDownload.js";
import { recordFlowFailure } from "@/cli/prompts/flows/utils.js";
import { resolveUserSkillsetRef } from "@/cli/skillsetResolution.js";
import { resolveOrgRegistryAuth } from "@/core/registryAuthResolution.js";
import { addSubagentToNoriJson, ensureNoriJson } from "@/norijson/nori.js";
import { verifyArchiveChecksum } from "@/packaging/archive.js";
import {
  atomicReplaceDirWithArchive,
  extractArchiveToNewDir,
} from "@/packaging/atomicReplace.js";
import { readVersionInfo, writeVersionInfo } from "@/packaging/provenance.js";
import {
  formatMultipleMatchesError,
  formatVersionList,
  searchSpecificRegistry,
} from "@/packaging/registryLookup.js";
import { resolveInstallDir } from "@/utils/path.js";
import {
  formatDefaultOrgNotice,
  namespacedName,
  parseNamespacedPackage,
} from "@/utils/url.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type {
  SubagentSearchResult,
  SubagentDownloadActionResult,
} from "@/cli/prompts/flows/subagentDownload.js";
import type { VersionInfo } from "@/packaging/provenance.js";
import type { RegistrySearchResult } from "@/packaging/registryLookup.js";
import type { Command } from "commander";

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
 * Flatten a directory-based subagent to a single .md file for agent installation.
 * Reads SUBAGENT.md, applies template substitution, writes to agents/<name>.md.
 * @param args - The flatten parameters
 * @param args.subagentDir - The source subagent directory containing SUBAGENT.md
 * @param args.subagentName - The subagent name (used for the output filename)
 * @param args.agentsDir - The target agents directory
 * @param args.installDir - The install directory for template substitution
 */
const flattenSubagentToAgentDir = async (args: {
  subagentDir: string;
  subagentName: string;
  agentsDir: string;
  installDir: string;
}): Promise<void> => {
  const { subagentDir, subagentName, agentsDir, installDir } = args;

  const subagentMdPath = path.join(subagentDir, "SUBAGENT.md");
  const content = await fs.readFile(subagentMdPath, "utf-8");
  const substituted = substituteTemplatePaths({ content, installDir });

  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(path.join(agentsDir, `${subagentName}.md`), substituted);
};

type SubagentDownloadArgs = {
  subagentSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
  skillset?: string | null;
  cliName?: CliName | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
};

const subagentDownloadMainImpl = async (
  args: SubagentDownloadArgs,
): Promise<CommandStatus> => {
  const {
    subagentSpec,
    installDir,
    registryUrl,
    listVersions,
    skillset,
    cliName,
    nonInteractive,
    silent,
  } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";

  // Load config first so a bare name can resolve against the configured default
  // org; an explicit --registry overrides that resolution.
  const config = await loadConfig();

  const parsed = parseNamespacedPackage({
    packageSpec: subagentSpec,
    defaultOrg: registryUrl == null ? config?.defaultOrg : null,
  });
  if (parsed == null) {
    log.error(
      `Invalid subagent specification: "${subagentSpec}".\nExpected format: subagent-name or org/subagent-name[@version]`,
    );
    return {
      success: false,
      cancelled: false,
      message: "Invalid subagent specification",
    };
  }
  const { orgId, packageName: subagentName, version } = parsed;
  const subagentDisplayName = namespacedName({
    orgId,
    packageName: subagentName,
  });

  const defaultOrgNotice = formatDefaultOrgNotice({
    packageSpec: subagentSpec,
    orgId,
    packageName: subagentName,
  });
  if (defaultOrgNotice != null && silent !== true) {
    log.info(defaultOrgNotice);
  }

  if (orgId !== "public" && registryUrl != null) {
    log.error(
      `Cannot specify both namespace and --registry flag.\n\nThe namespace "${orgId}/" determines the registry automatically.\nUse either "${subagentDisplayName}" (derived registry) or "${subagentName} --registry ${registryUrl}" (explicit registry).`,
    );
    return {
      success: false,
      cancelled: false,
      message: "Invalid flag combination",
    };
  }

  const targetInstallDir = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  }).path;

  // targetSkillset is the user-facing (bare) skillset name for display;
  // targetSkillsetDir is its resolved on-disk directory for file writes.
  const targetRef = await resolveUserSkillsetRef({
    name: skillset,
    activeSkillset: config != null ? getActiveSkillset({ config }) : null,
    defaultOrg: config?.defaultOrg,
    nameWasProvided: skillset != null,
    warn: !nonInteractive,
  });
  let targetSkillset = targetRef?.identity ?? null;
  let targetSkillsetDir = targetRef?.dir ?? null;

  if (targetSkillsetDir != null) {
    await ensureNoriJson({ skillsetDir: targetSkillsetDir });
    try {
      await fs.access(path.join(targetSkillsetDir, "nori.json"));
    } catch {
      targetSkillset = null;
      targetSkillsetDir = null;
    }
  }

  if (skillset != null && targetSkillsetDir == null) {
    log.error(
      `Skillset "${skillset}" not found.\n\nMake sure the skillset exists and contains a nori.json file.`,
    );
    return {
      success: false,
      cancelled: false,
      message: "Skillset not found",
    };
  }

  const defaultAgentNames = getDefaultAgents({ config });
  const defaultAgents = defaultAgentNames.map((name) =>
    AgentRegistry.getInstance().get({ name }),
  );
  const primaryAgent = defaultAgents[0];

  const primaryAgentsDir = primaryAgent.getSubagentsDir({
    installDir: targetInstallDir,
  });

  // Ensure agents directory exists for all agents
  for (const agent of defaultAgents) {
    await fs.mkdir(agent.getSubagentsDir({ installDir: targetInstallDir }), {
      recursive: true,
    });
  }

  // The subagent directory in the skillset profile (full directory structure)
  let profileSubagentDir: string | null = null;
  if (targetSkillsetDir != null) {
    profileSubagentDir = path.join(
      targetSkillsetDir,
      "subagents",
      subagentName,
    );
  }

  // Check if subagent already exists in profile
  let existingVersionInfo: VersionInfo | null = null;
  let subagentExists = false;
  if (profileSubagentDir != null) {
    try {
      await fs.access(profileSubagentDir);
      subagentExists = true;
      existingVersionInfo = await readVersionInfo({ dir: profileSubagentDir });
    } catch {
      // Directory doesn't exist
    }
  }

  let foundRegistry: RegistrySearchResult | null = null;
  let resolvedTargetVersion = "";
  // The flow resolves to null for BOTH a user cancel and a callback-reported
  // failure; record failures so real errors are not mistaken for a cancel.
  let flowError: string | null = null;

  const result = await subagentDownloadFlow({
    subagentDisplayName,
    nonInteractive: nonInteractive ?? silent ?? null,
    callbacks: {
      onSearch: recordFlowFailure({
        onFailure: (error) => {
          flowError = error;
        },
        fn: async (): Promise<SubagentSearchResult> => {
          let flowSearchResults: Array<RegistrySearchResult>;

          const hasUnifiedAuth =
            config?.auth != null &&
            hasRegistryAuthCredentials({ auth: config.auth }) &&
            config.auth.organizations != null;

          if (registryUrl != null) {
            const registryAuth =
              config != null ? getRegistryAuth({ config, registryUrl }) : null;
            if (registryUrl !== REGISTRAR_URL && registryAuth == null) {
              return {
                status: "error",
                error: `No authentication configured for registry: ${registryUrl}`,
                hint: "Add registry credentials to your .nori-config.json file.",
              };
            }

            const searchResult =
              (
                await searchSpecificRegistry({
                  registryUrl,
                  fetchPackument: (fetchArgs) =>
                    registrarApi.getSubagentPackument({
                      subagentName,
                      ...fetchArgs,
                    }),
                  getAuthToken:
                    registryAuth != null
                      ? () => getRegistryAuthToken({ registryAuth })
                      : null,
                })
              ).result ?? null;
            flowSearchResults = searchResult != null ? [searchResult] : [];
          } else if (orgId === "public") {
            try {
              const packument = await registrarApi.getSubagentPackument({
                subagentName,
                registryUrl: REGISTRAR_URL,
              });
              flowSearchResults = [{ registryUrl: REGISTRAR_URL, packument }];
            } catch {
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
              const packument = await registrarApi.getSubagentPackument({
                subagentName,
                registryUrl: targetRegistryUrl,
                authToken,
              });
              flowSearchResults = [
                { registryUrl: targetRegistryUrl, packument, authToken },
              ];
            } catch {
              flowSearchResults = [];
            }
          } else {
            return {
              status: "error",
              error: `Subagent "${orgId}/${subagentName}" not found.`,
              hint: `To download from organization "${orgId}", log in with:\n  nori-skillsets login`,
            };
          }

          if (flowSearchResults.length === 0) {
            return {
              status: "error",
              error: `Subagent "${subagentDisplayName}" not found in any registry.`,
            };
          }

          if (flowSearchResults.length > 1) {
            return {
              status: "error",
              error: formatMultipleMatchesError({
                packageName: subagentName,
                results: flowSearchResults,
                entityLabel: "subagents",
                downloadCommand: `${cliPrefix} ${commandNames.downloadSubagent}`,
              }),
            };
          }

          foundRegistry = flowSearchResults[0];

          if (listVersions) {
            return {
              status: "list-versions",
              formattedVersionList: formatVersionList({
                packageName: subagentName,
                packument: foundRegistry.packument,
                registryUrl: foundRegistry.registryUrl,
                downloadCommand: `${cliPrefix} ${commandNames.downloadSubagent}`,
              }),
              versionCount: Object.keys(foundRegistry.packument.versions)
                .length,
            };
          }

          resolvedTargetVersion =
            version ?? foundRegistry.packument["dist-tags"].latest;

          if (subagentExists && existingVersionInfo != null) {
            const installedVersion = existingVersionInfo.version;
            const installedValid = semver.valid(installedVersion) != null;
            const targetValid = semver.valid(resolvedTargetVersion) != null;

            if (installedValid && targetValid) {
              if (semver.gte(installedVersion, resolvedTargetVersion)) {
                return {
                  status: "already-current",
                  version: installedVersion,
                };
              }
              return {
                status: "ready",
                targetVersion: resolvedTargetVersion,
                isUpdate: true,
                currentVersion: installedVersion,
              };
            } else if (installedVersion === resolvedTargetVersion) {
              return {
                status: "already-current",
                version: installedVersion,
              };
            }
          }

          if (subagentExists && existingVersionInfo == null) {
            return {
              status: "error",
              error: `Subagent "${subagentDisplayName}" already exists at:\n${profileSubagentDir}\n\nThis subagent has no version information (.nori-version file).`,
              hint: `To reinstall:\n  rm -rf "${profileSubagentDir}"\n  ${cliPrefix} ${commandNames.downloadSubagent} ${subagentDisplayName}`,
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
        fn: async (): Promise<SubagentDownloadActionResult> => {
          const selectedRegistry = foundRegistry!;
          const warnings: Array<string> = [];

          try {
            const tarballData = await registrarApi.downloadSubagentTarball({
              subagentName,
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

            // Determine where to extract the full subagent directory
            // Priority: profile subagents dir > temp dir (for flattening only)
            const extractTarget =
              profileSubagentDir ??
              path.join(primaryAgentsDir, `.${subagentName}-download-temp`);

            if (subagentExists && profileSubagentDir != null) {
              await atomicReplaceDirWithArchive({
                tarballData,
                targetDir: profileSubagentDir,
                preserveVersionFile: true,
              });
            } else {
              await extractArchiveToNewDir({
                tarballData,
                targetDir: extractTarget,
              });
            }

            // Write .nori-version file in the subagent directory
            const activeExtractDir = profileSubagentDir ?? extractTarget;
            await writeVersionInfo({
              dir: activeExtractDir,
              versionInfo: {
                version: resolvedTargetVersion,
                registryUrl: selectedRegistry.registryUrl,
                orgId,
              },
            });

            // Persist to profile if we haven't already (i.e., extractTarget was a temp dir)
            if (
              profileSubagentDir != null &&
              extractTarget !== profileSubagentDir
            ) {
              try {
                await fs.rm(profileSubagentDir, {
                  recursive: true,
                  force: true,
                });
                await copyDirRecursive({
                  src: extractTarget,
                  dest: profileSubagentDir,
                });
              } catch (profileCopyErr) {
                const msg =
                  profileCopyErr instanceof Error
                    ? profileCopyErr.message
                    : String(profileCopyErr);
                warnings.push(
                  `Warning: Could not persist subagent to skillset: ${msg}`,
                );
              }
            }

            // Flatten SUBAGENT.md to primary agent's agents directory
            const primaryAgentDir = primaryAgent.getAgentDir({
              installDir: targetInstallDir,
            });
            await flattenSubagentToAgentDir({
              subagentDir: activeExtractDir,
              subagentName,
              agentsDir: primaryAgentsDir,
              installDir: primaryAgentDir,
            });

            const installedFile = path.join(
              primaryAgentsDir,
              `${subagentName}.md`,
            );

            // Broadcast: flatten to all other agents' agents directories
            for (const agent of defaultAgents.slice(1)) {
              const agentSubagentsDir = agent.getSubagentsDir({
                installDir: targetInstallDir,
              });
              try {
                const agentDir = agent.getAgentDir({
                  installDir: targetInstallDir,
                });
                await flattenSubagentToAgentDir({
                  subagentDir: activeExtractDir,
                  subagentName,
                  agentsDir: agentSubagentsDir,
                  installDir: agentDir,
                });
              } catch (copyErr) {
                const msg =
                  copyErr instanceof Error ? copyErr.message : String(copyErr);
                warnings.push(
                  `Warning: Could not copy subagent to ${agent.name}: ${msg}`,
                );
              }
            }

            // Clean up temp dir if we used one
            if (extractTarget !== profileSubagentDir) {
              await fs
                .rm(extractTarget, { recursive: true, force: true })
                .catch(() => {
                  // Temp may not exist
                });
            }

            // Update nori.json
            let profileUpdateMessage: string | null = null;
            if (targetSkillsetDir != null) {
              try {
                await addSubagentToNoriJson({
                  skillsetDir: targetSkillsetDir,
                  subagentName,
                  version: resolvedTargetVersion,
                });
                profileUpdateMessage = `Added "${subagentDisplayName}" to ${targetSkillset} skillset nori.json`;
              } catch (noriJsonErr) {
                const msg =
                  noriJsonErr instanceof Error
                    ? noriJsonErr.message
                    : String(noriJsonErr);
                warnings.push(`Warning: Could not update nori.json: ${msg}`);
              }
            }

            return {
              success: true,
              version: resolvedTargetVersion,
              isUpdate: subagentExists,
              installedTo: installedFile,
              subagentDisplayName,
              profileUpdateMessage,
              warnings,
            };
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return {
              success: false,
              error: `Failed to download subagent "${subagentDisplayName}": ${errorMessage}`,
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

  return { success: true, cancelled: false, message: result.statusMessage };
};

export const subagentDownloadMain = async (
  args: SubagentDownloadArgs,
): Promise<CommandStatus> =>
  withInstallLock({ operation: () => subagentDownloadMainImpl(args) });

export const registerSubagentDownloadCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("subagent-download <subagent>")
    .description(
      "Download and install a subagent package from the Nori registrar",
    )
    .option(
      "--registry <url>",
      "Download from a specific registry URL instead of searching all registries",
    )
    .option(
      "--list-versions",
      "List available versions for the subagent instead of downloading",
    )
    .option(
      "--skillset <name>",
      "Add subagent to the specified skillset's nori.json (defaults to active skillset)",
    )
    .action(
      async (
        subagentSpec: string,
        options: {
          registry?: string;
          listVersions?: boolean;
          skillset?: string;
        },
      ) => {
        const globalOpts = program.opts();

        await subagentDownloadMain({
          subagentSpec,
          installDir: globalOpts.installDir || null,
          registryUrl: options.registry || null,
          listVersions: options.listVersions || null,
          skillset: options.skillset || null,
          nonInteractive: globalOpts.nonInteractive || null,
          silent: globalOpts.silent || null,
        });
      },
    );
};
