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
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";

import { log } from "@clack/prompts";
import * as semver from "semver";
import * as tar from "tar";

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
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { subagentDownloadFlow } from "@/cli/prompts/flows/subagentDownload.js";
import { addSubagentToNoriJson, ensureNoriJson } from "@/norijson/nori.js";
import { getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";
import {
  parseNamespacedPackage,
  buildOrganizationRegistryUrl,
} from "@/utils/url.js";

import type { Packument } from "@/api/registrar.js";
import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { Config } from "@/cli/config.js";
import type {
  SubagentSearchResult,
  SubagentDownloadActionResult,
} from "@/cli/prompts/flows/subagentDownload.js";
import type { Command } from "commander";

type VersionInfo = {
  version: string;
  registryUrl: string;
  orgId?: string | null;
};

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

const isGzipped = (args: { buffer: Buffer }): boolean => {
  const { buffer } = args;
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
};

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

type RegistrySearchResult = {
  registryUrl: string;
  packument: Packument;
  authToken?: string | null;
};

const searchSpecificRegistry = async (args: {
  subagentName: string;
  registryUrl: string;
  config: Config | null;
}): Promise<RegistrySearchResult | null> => {
  const { subagentName, registryUrl, config } = args;

  if (registryUrl === REGISTRAR_URL) {
    try {
      const packument = await registrarApi.getSubagentPackument({
        subagentName,
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

  if (config == null) {
    return null;
  }

  const registryAuth = getRegistryAuth({ config, registryUrl });
  if (registryAuth == null) {
    return null;
  }

  try {
    const authToken = await getRegistryAuthToken({ registryAuth });
    const packument = await registrarApi.getSubagentPackument({
      subagentName,
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

const formatVersionList = (args: {
  subagentName: string;
  packument: Packument;
  registryUrl: string;
  cliName?: CliName | null;
}): string => {
  const { subagentName, packument, registryUrl, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";
  const distTags = packument["dist-tags"];
  const versions = Object.keys(packument.versions);
  const timeInfo = packument.time ?? {};

  const sortedVersions = versions.sort((a, b) => {
    const timeA = timeInfo[a] ? new Date(timeInfo[a]).getTime() : 0;
    const timeB = timeInfo[b] ? new Date(timeInfo[b]).getTime() : 0;
    return timeB - timeA;
  });

  const lines = [
    `Available versions of "${subagentName}" from ${registryUrl}:\n`,
    "Dist-tags:",
  ];

  for (const [tag, version] of Object.entries(distTags)) {
    lines.push(`  ${tag}: ${version}`);
  }

  lines.push("\nVersions:");

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
    `\nTo download a specific version:\n  ${cliPrefix} ${commandNames.downloadSubagent} ${subagentName}@<version>`,
  );

  return lines.join("\n");
};

const formatMultipleSubagentsError = (args: {
  subagentName: string;
  results: Array<RegistrySearchResult>;
  cliName?: CliName | null;
}): string => {
  const { subagentName, results, cliName } = args;
  const commandNames = getCommandNames({ cliName });
  const cliPrefix = cliName ?? "nori-skillsets";

  const lines = ["Multiple subagents with the same name found.\n"];

  for (const result of results) {
    const version = result.packument["dist-tags"].latest ?? "unknown";
    const description = result.packument.description ?? "";
    lines.push(result.registryUrl);
    lines.push(`  -> ${subagentName}@${version}: ${description}\n`);
  }

  lines.push("To download, please specify the registry with --registry:");
  for (const result of results) {
    lines.push(
      `${cliPrefix} ${commandNames.downloadSubagent} ${subagentName} --registry ${result.registryUrl}`,
    );
  }

  return lines.join("\n");
};

export const subagentDownloadMain = async (args: {
  subagentSpec: string;
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

  const parsed = parseNamespacedPackage({ packageSpec: subagentSpec });
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
  const subagentDisplayName =
    orgId === "public" ? subagentName : `${orgId}/${subagentName}`;

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

  const config = await loadConfig();

  const targetInstallDir = resolveInstallDir({
    cliInstallDir: installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  }).path;

  let targetSkillset: string | null = null;
  const skillsetsDir = getNoriSkillsetsDir();

  if (skillset != null) {
    const skillsetDir = path.join(skillsetsDir, skillset);
    await ensureNoriJson({ skillsetDir });
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
    const activeSkillset = getActiveSkillset({ config });
    if (activeSkillset != null) {
      const skillsetDir = path.join(skillsetsDir, activeSkillset);
      try {
        await fs.access(skillsetDir);
        targetSkillset = activeSkillset;
      } catch {
        // Skillset directory doesn't exist - skip
      }
    }
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
  if (targetSkillset != null) {
    profileSubagentDir = path.join(
      skillsetsDir,
      targetSkillset,
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

  const result = await subagentDownloadFlow({
    subagentDisplayName,
    nonInteractive: nonInteractive ?? silent ?? null,
    callbacks: {
      onSearch: async (): Promise<SubagentSearchResult> => {
        let flowSearchResults: Array<RegistrySearchResult>;

        const hasUnifiedAuth =
          config?.auth != null &&
          config.auth.refreshToken != null &&
          config.auth.organizations != null;

        if (registryUrl != null) {
          if (registryUrl !== REGISTRAR_URL) {
            const registryAuth =
              config != null ? getRegistryAuth({ config, registryUrl }) : null;
            if (registryAuth == null) {
              return {
                status: "error",
                error: `No authentication configured for registry: ${registryUrl}`,
                hint: "Add registry credentials to your .nori-config.json file.",
              };
            }
          }

          const searchResult = await searchSpecificRegistry({
            subagentName,
            registryUrl,
            config,
          });
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
            username: config.auth!.username ?? null,
            refreshToken: config.auth!.refreshToken ?? null,
            apiToken: config.auth!.apiToken ?? null,
          };

          try {
            const authToken = await getRegistryAuthToken({ registryAuth });
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
            error: formatMultipleSubagentsError({
              subagentName,
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
              subagentName,
              packument: foundRegistry.packument,
              registryUrl: foundRegistry.registryUrl,
              cliName,
            }),
            versionCount: Object.keys(foundRegistry.packument.versions).length,
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
      onDownload: async (): Promise<SubagentDownloadActionResult> => {
        const selectedRegistry = foundRegistry!;
        const warnings: Array<string> = [];

        try {
          const tarballData = await registrarApi.downloadSubagentTarball({
            subagentName,
            version: version ?? undefined,
            registryUrl: selectedRegistry.registryUrl,
            authToken: selectedRegistry.authToken ?? undefined,
          });

          // Determine where to extract the full subagent directory
          // Priority: profile subagents dir > temp dir (for flattening only)
          const extractTarget =
            profileSubagentDir ??
            path.join(primaryAgentsDir, `.${subagentName}-download-temp`);

          if (subagentExists && profileSubagentDir != null) {
            // Update existing subagent directory with atomic swap
            const tempDir = path.join(
              path.dirname(profileSubagentDir),
              `.${subagentName}-download-temp`,
            );
            const backupDir = path.join(
              path.dirname(profileSubagentDir),
              `.${subagentName}-backup`,
            );
            await fs.mkdir(tempDir, { recursive: true });

            try {
              await extractTarball({ tarballData, targetDir: tempDir });
            } catch (extractErr) {
              await fs.rm(tempDir, { recursive: true, force: true });
              throw extractErr;
            }

            try {
              await fs.rename(profileSubagentDir, backupDir);
              await fs.rename(tempDir, profileSubagentDir);

              const backupVersionFile = path.join(backupDir, ".nori-version");
              try {
                await fs.access(backupVersionFile);
                await fs.copyFile(
                  backupVersionFile,
                  path.join(profileSubagentDir, ".nori-version"),
                );
              } catch {
                // No .nori-version in backup
              }

              await fs.rm(backupDir, { recursive: true, force: true });
            } catch (swapErr) {
              try {
                await fs.access(backupDir);
                await fs
                  .rm(profileSubagentDir, { recursive: true, force: true })
                  .catch(() => {
                    // Target may not exist
                  });
                await fs.rename(backupDir, profileSubagentDir);
              } catch {
                // Restore failed
              }
              await fs
                .rm(tempDir, { recursive: true, force: true })
                .catch(() => {
                  // Temp may not exist
                });
              throw swapErr;
            }
          } else {
            // New install
            await fs.mkdir(extractTarget, { recursive: true });

            try {
              await extractTarball({ tarballData, targetDir: extractTarget });
            } catch (extractErr) {
              await fs.rm(extractTarget, { recursive: true, force: true });
              throw extractErr;
            }
          }

          // Write .nori-version file in the subagent directory
          const activeExtractDir = profileSubagentDir ?? extractTarget;
          const versionData = JSON.stringify(
            {
              version: resolvedTargetVersion,
              registryUrl: selectedRegistry.registryUrl,
              orgId,
            },
            null,
            2,
          );
          await fs.writeFile(
            path.join(activeExtractDir, ".nori-version"),
            versionData,
          );

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
          if (targetSkillset != null) {
            try {
              await addSubagentToNoriJson({
                skillsetDir: path.join(skillsetsDir, targetSkillset),
                subagentName,
                version: "*",
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
          const errorMessage = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: `Failed to download subagent "${subagentDisplayName}": ${errorMessage}`,
          };
        }
      },
    },
  });

  if (result == null) {
    return { success: false, cancelled: true, message: "" };
  }

  return { success: true, cancelled: false, message: result.statusMessage };
};

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
