/**
 * CLI command for downloading skill packages from the Nori registrar
 * Handles: nori-skillsets download-skill <skill>[@version] [--registry <url>]
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log } from "@clack/prompts";
import * as semver from "semver";

import { registrarApi, REGISTRAR_URL } from "@/api/registrar.js";
import { getRegistryAuthToken } from "@/api/registryAuth.js";
import {
  getCommandNames,
  type CliName,
} from "@/cli/commands/cliCommandNames.js";
import {
  getRegistryAuth,
  getDefaultAgents,
  hasRegistryAuthCredentials,
  loadConfig,
  getActiveSkillset,
  toRegistryAuth,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { addSkillDependency } from "@/cli/features/skillResolver.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { skillDownloadFlow } from "@/cli/prompts/flows/index.js";
import { recordFlowFailure } from "@/cli/prompts/flows/utils.js";
import { addSkillToNoriJson, ensureNoriJson } from "@/norijson/nori.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
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
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type {
  SkillSearchResult,
  SkillDownloadActionResult,
} from "@/cli/prompts/flows/index.js";
import type { VersionInfo } from "@/packaging/provenance.js";
import type { RegistrySearchResult } from "@/packaging/registryLookup.js";
import type { Command } from "commander";

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
 * Download and install a skill from the registrar
 * @param args - The download parameters
 * @param args.skillSpec - Skill name with optional version (e.g., "my-skill" or "my-skill@1.0.0")
 * @param args.cwd - Current working directory (defaults to process.cwd())
 * @param args.installDir - Optional explicit install directory
 * @param args.registryUrl - Optional registry URL to download from
 * @param args.listVersions - If true, list available versions instead of downloading
 * @param args.skillset - Optional skillset name to add skill to (defaults to active skillset)
 * @param args.cliName - CLI name for user-facing messages (defaults to nori-skillsets)
 * @param args.nonInteractive - If true, skip interactive prompts and use defaults
 * @param args.silent - If true, suppress output (implies nonInteractive)
 *
 * @returns Command status
 */
export const skillDownloadMain = async (args: {
  skillSpec: string;
  cwd?: string | null;
  installDir?: string | null;
  registryUrl?: string | null;
  listVersions?: boolean | null;
  skillset?: string | null;
  cliName?: CliName | null;
  nonInteractive?: boolean | null;
  silent?: boolean | null;
}): Promise<CommandStatus> => {
  const {
    skillSpec,
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

  // Parse the namespaced skill spec (e.g., "myorg/my-skill@1.0.0")
  const parsed = parseNamespacedPackage({ packageSpec: skillSpec });
  if (parsed == null) {
    log.error(
      `Invalid skill specification: "${skillSpec}".\nExpected format: skill-name or org/skill-name[@version]`,
    );
    return {
      success: false,
      cancelled: false,
      message: "Invalid skill specification",
    };
  }
  const { orgId, packageName: skillName, version } = parsed;
  // Display name includes org prefix for namespaced packages (e.g., "myorg/my-skill")
  const skillDisplayName =
    orgId === "public" ? skillName : `${orgId}/${skillName}`;

  // Check for namespace/registry conflict
  if (orgId !== "public" && registryUrl != null) {
    log.error(
      `Cannot specify both namespace and --registry flag.\n\nThe namespace "${orgId}/" determines the registry automatically.\nUse either "${skillDisplayName}" (derived registry) or "${skillName} --registry ${registryUrl}" (explicit registry).`,
    );
    return {
      success: false,
      cancelled: false,
      message: "Invalid flag combination",
    };
  }

  // Load config for auth and install dir resolution
  const config = await loadConfig();

  // Resolve installation directory from CLI flag, config, or home dir fallback
  const targetInstallDir = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  }).path;

  // Resolve target skillset for manifest update
  // Priority: --skillset option > active skillset from config > no manifest update
  let targetSkillset: string | null = null;
  const skillsetsDir = getNoriSkillsetsDir();

  if (skillset != null) {
    // User specified a skillset - verify it exists
    const skillsetDir = path.join(skillsetsDir, skillset);
    await ensureNoriJson({ skillsetDir: skillsetDir });
    const skillsetMarker = path.join(skillsetDir, "nori.json");
    try {
      await fs.access(skillsetMarker);
      targetSkillset = skillset;
    } catch {
      log.error(
        `Skillset "${skillset}" not found at: ${skillsetDir}\n\nMake sure the skillset exists and contains a nori.json file.`,
      );
      return {
        success: false,
        cancelled: false,
        message: "Skillset not found",
      };
    }
  } else if (config != null) {
    // No skillset specified - try to use active skillset
    const activeSkillset = getActiveSkillset({ config });
    if (activeSkillset != null) {
      // Verify skillset directory exists
      const skillsetDir = path.join(skillsetsDir, activeSkillset);
      try {
        await fs.access(skillsetDir);
        targetSkillset = activeSkillset;
      } catch {
        // Skillset directory doesn't exist - skip manifest update
      }
    }
  }

  // Resolve all default agents for broadcasting
  const defaultAgentNames = getDefaultAgents({ config });
  const defaultAgents = defaultAgentNames.map((name) =>
    AgentRegistry.getInstance().get({ name }),
  );
  const primaryAgent = defaultAgents[0];

  const skillsDir = primaryAgent.getSkillsDir({ installDir: targetInstallDir });

  // Ensure skills directory exists for all agents
  for (const agent of defaultAgents) {
    await fs.mkdir(agent.getSkillsDir({ installDir: targetInstallDir }), {
      recursive: true,
    });
  }

  const targetDir = path.join(skillsDir, skillName);

  // Check if skill already exists and get its version info
  let existingVersionInfo: VersionInfo | null = null;
  let skillExists = false;
  try {
    await fs.access(targetDir);
    skillExists = true;
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

  const result = await skillDownloadFlow({
    skillDisplayName,
    nonInteractive: nonInteractive ?? silent ?? null,
    callbacks: {
      onSearch: recordFlowFailure({
        onFailure: (error) => {
          flowError = error;
        },
        fn: async (): Promise<SkillSearchResult> => {
          // Inline search logic
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
                    registrarApi.getSkillPackument({ skillName, ...fetchArgs }),
                  getAuthToken:
                    registryAuth != null
                      ? () => getRegistryAuthToken({ registryAuth })
                      : null,
                })
              ).result ?? null;
            flowSearchResults = searchResult != null ? [searchResult] : [];
          } else if (orgId === "public") {
            try {
              const packument = await registrarApi.getSkillPackument({
                skillName,
                registryUrl: REGISTRAR_URL,
              });
              flowSearchResults = [{ registryUrl: REGISTRAR_URL, packument }];
            } catch {
              flowSearchResults = [];
            }
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

            const registryAuth = toRegistryAuth({
              auth: config.auth!,
              registryUrl: targetRegistryUrl,
            });

            try {
              const authToken = await getRegistryAuthToken({ registryAuth });
              const packument = await registrarApi.getSkillPackument({
                skillName,
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
              error: `Skill "${orgId}/${skillName}" not found.`,
              hint: `To download from organization "${orgId}", log in with:\n  nori-skillsets login`,
            };
          }

          if (flowSearchResults.length === 0) {
            return {
              status: "error",
              error: `Skill "${skillDisplayName}" not found in any registry.`,
            };
          }

          if (flowSearchResults.length > 1) {
            return {
              status: "error",
              error: formatMultipleMatchesError({
                packageName: skillName,
                results: flowSearchResults,
                entityLabel: "skills",
                downloadCommand: `${cliPrefix} ${commandNames.downloadSkill}`,
              }),
            };
          }

          foundRegistry = flowSearchResults[0];

          if (listVersions) {
            return {
              status: "list-versions",
              formattedVersionList: formatVersionList({
                packageName: skillName,
                packument: foundRegistry.packument,
                registryUrl: foundRegistry.registryUrl,
                downloadCommand: `${cliPrefix} ${commandNames.downloadSkill}`,
              }),
              versionCount: Object.keys(foundRegistry.packument.versions)
                .length,
            };
          }

          resolvedTargetVersion =
            version ?? foundRegistry.packument["dist-tags"].latest;

          if (skillExists && existingVersionInfo != null) {
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

          if (skillExists && existingVersionInfo == null) {
            return {
              status: "error",
              error: `Skill "${skillDisplayName}" already exists at:\n${targetDir}\n\nThis skill has no version information (.nori-version file).`,
              hint: `To reinstall:\n  rm -rf "${targetDir}"\n  ${cliPrefix} ${commandNames.downloadSkill} ${skillDisplayName}`,
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
        fn: async (): Promise<SkillDownloadActionResult> => {
          const selectedRegistry = foundRegistry!;
          const warnings: Array<string> = [];

          try {
            const tarballData = await registrarApi.downloadSkillTarball({
              skillName,
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

            if (skillExists) {
              await atomicReplaceDirWithArchive({
                tarballData,
                targetDir,
                preserveVersionFile: true,
              });
            } else {
              await extractArchiveToNewDir({ tarballData, targetDir });
            }

            await writeVersionInfo({
              dir: targetDir,
              versionInfo: {
                version: resolvedTargetVersion,
                registryUrl: selectedRegistry.registryUrl,
                orgId,
              },
            });

            // Persist skill to skillset's skills directory
            if (targetSkillset != null) {
              const profileSkillDir = path.join(
                skillsetsDir,
                targetSkillset,
                "skills",
                skillName,
              );
              try {
                await fs.rm(profileSkillDir, {
                  recursive: true,
                  force: true,
                });
                await copyDirRecursive({
                  src: targetDir,
                  dest: profileSkillDir,
                });
              } catch (profileCopyErr) {
                const msg =
                  profileCopyErr instanceof Error
                    ? profileCopyErr.message
                    : String(profileCopyErr);
                warnings.push(
                  `Warning: Could not persist skill to skillset: ${msg}`,
                );
              }
            }

            // Apply template substitution for primary agent
            const primaryAgentDir = primaryAgent.getAgentDir({
              installDir: targetInstallDir,
            });
            await applyTemplateSubstitutionToDir({
              dir: targetDir,
              installDir: primaryAgentDir,
            });

            // Broadcast: copy skill to all other agents' skills directories
            for (const agent of defaultAgents.slice(1)) {
              const agentSkillsDir = agent.getSkillsDir({
                installDir: targetInstallDir,
              });
              const agentTargetDir = path.join(agentSkillsDir, skillName);
              try {
                await fs.rm(agentTargetDir, { recursive: true, force: true });
                await copyDirRecursive({
                  src: targetDir,
                  dest: agentTargetDir,
                });
                // Re-apply template substitution with this agent's dir
                const agentDir = agent.getAgentDir({
                  installDir: targetInstallDir,
                });
                await applyTemplateSubstitutionToDir({
                  dir: agentTargetDir,
                  installDir: agentDir,
                });
              } catch (copyErr) {
                const msg =
                  copyErr instanceof Error ? copyErr.message : String(copyErr);
                warnings.push(
                  `Warning: Could not copy skill to ${agent.name}: ${msg}`,
                );
              }
            }

            // Update skillset manifest
            let profileUpdateMessage: string | null = null;
            if (targetSkillset != null) {
              try {
                await addSkillDependency({
                  skillsetDir: path.join(skillsetsDir, targetSkillset),
                  skillName,
                  version: resolvedTargetVersion,
                });
                profileUpdateMessage = `Added "${skillDisplayName}" to ${targetSkillset} skillset manifest`;
              } catch (manifestErr) {
                const msg =
                  manifestErr instanceof Error
                    ? manifestErr.message
                    : String(manifestErr);
                warnings.push(
                  `Warning: Could not update skillset manifest: ${msg}`,
                );
              }
            }

            // Update nori.json
            if (targetSkillset != null) {
              try {
                await addSkillToNoriJson({
                  skillsetDir: path.join(skillsetsDir, targetSkillset),
                  skillName,
                  version: resolvedTargetVersion,
                });
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
              isUpdate: skillExists,
              installedTo: targetDir,
              skillDisplayName,
              profileUpdateMessage,
              warnings,
            };
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            return {
              success: false,
              error: `Failed to download skill "${skillDisplayName}": ${errorMessage}`,
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
          nonInteractive: globalOpts.nonInteractive || null,
          silent: globalOpts.silent || null,
        });
      },
    );
};
