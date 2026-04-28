/**
 * Skillset management for Nori Skillsets
 * Handles skillset listing, loading, and switching
 */

import * as fs from "fs/promises";
import * as path from "path";

import { log, select, isCancel, cancel } from "@clack/prompts";

import {
  loadConfig,
  updateConfig,
  getActiveSkillset,
  getDefaultAgents,
  type Config,
} from "@/cli/config.js";
import {
  switchSkillset as switchSkillsetOp,
  detectLocalChanges,
  captureExistingConfig,
} from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { substituteTemplatePaths } from "@/cli/features/template.js";
import { setSilentMode, isSilentMode } from "@/cli/logger.js";
import { switchSkillsetFlow } from "@/cli/prompts/flows/switchSkillset.js";
import { listSkillsets, getNoriSkillsetsDir } from "@/norijson/skillset.js";
import { resolveInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
import type { Command } from "commander";

/**
 * Shared action handler for switch-skillset commands
 * @param args - Configuration arguments
 * @param args.name - The skillset name to switch to (optional - prompts if omitted)
 * @param args.options - Command options
 * @param args.options.agent - Optional agent name override
 * @param args.program - Commander program instance
 * @param args.options.force - Whether to force through local changes without prompting
 *
 * @returns Command status
 */
export const switchSkillsetAction = async (args: {
  name?: string | null;
  options: { agent?: string; force?: boolean };
  program: Command;
}): Promise<CommandStatus> => {
  const { options, program } = args;
  let { name } = args;

  // Get global options from parent
  const globalOpts = program.opts();
  const nonInteractive = globalOpts.nonInteractive ?? false;
  const force = options.force ?? false;
  const agentOverride = options.agent ?? globalOpts.agent ?? null;

  // Determine installation directory: CLI flag > config > home dir
  const config = await loadConfig();
  const resolved = resolveInstallDir({
    cliInstallDir: globalOpts.installDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });
  const installDir = resolved.path;

  // Skip manifest operations when the install dir comes from a CLI override.
  // The manifest is stored globally per-agent and would produce false positives
  // when compared against a transient override directory.
  const skipManifest = resolved.source === "cli";

  // If no name provided, prompt for selection or error in non-interactive mode
  if (name == null) {
    if (nonInteractive) {
      const skillsets = await listSkillsets();
      const available =
        skillsets.length > 0
          ? ` Available skillsets: ${skillsets.join(", ")}`
          : "";
      throw new Error(
        `No skillset name provided.${available} Usage: sks switch <name>`,
      );
    }

    const skillsets = await listSkillsets();
    if (skillsets.length === 0) {
      throw new Error(
        "No skillsets installed. Install a skillset first with: sks download <name>",
      );
    }

    const selected = await select({
      message: "Select a skillset to switch to",
      options: skillsets.map((s) => ({ value: s, label: s })),
    });

    if (isCancel(selected)) {
      cancel("Skillset switch cancelled.");
      return { success: false, cancelled: true, message: "" };
    }

    name = selected as string;
  }

  // Interactive flow
  if (!nonInteractive) {
    const redownloadEnabled = config?.redownloadOnSwitch !== "disabled";

    const flowResult = await switchSkillsetFlow({
      skillsetName: name,
      installDir,
      callbacks: {
        onResolveAgents: async () => {
          const config = await loadConfig();
          const agentNames = getDefaultAgents({ config, agentOverride });
          return agentNames.map((agentName) => {
            const agent = AgentRegistry.getInstance().get({
              name: agentName,
            });
            return { name: agentName, displayName: agent.displayName };
          });
        },
        onPrepareSwitchInfo: async ({
          installDir: dir,
          agentName: agentName,
        }) => {
          const agent = AgentRegistry.getInstance().get({ name: agentName });
          const localChanges = skipManifest
            ? null
            : await detectLocalChanges({
                agent,
                installDir: dir,
              });
          const config = await loadConfig();
          const currentProfile =
            config != null ? getActiveSkillset({ config }) : null;
          return { currentProfile, localChanges };
        },
        onCaptureConfig: async ({ installDir: dir, skillsetName: pName }) => {
          const captureConfig = await loadConfig();
          const captureAgentNames = getDefaultAgents({
            config: captureConfig,
            agentOverride,
          });
          const config: Config = {
            installDir: dir,
            activeSkillset: pName,
          };
          // Capture existing config for all default agents that support it
          for (const captureAgentName of captureAgentNames) {
            const captureAgent = AgentRegistry.getInstance().get({
              name: captureAgentName,
            });
            await captureExistingConfig({
              agent: captureAgent,
              installDir: dir,
              skillsetName: pName,
              config,
            });
          }
        },
        onExecuteSwitch: async ({
          installDir: dir,
          agentName,
          skillsetName: pName,
        }) => {
          const agent = AgentRegistry.getInstance().get({ name: agentName });
          const wasSilent = isSilentMode();
          setSilentMode({ silent: true });
          try {
            await switchSkillsetOp({
              agent,
              installDir: dir,
              skillsetName: pName,
            });
          } catch (err) {
            setSilentMode({ silent: wasSilent });
            const profiles = await listSkillsets();
            if (profiles.length > 0) {
              log.error(`Available skillsets: ${profiles.join(", ")}`);
            }
            throw err;
          }
          setSilentMode({ silent: wasSilent });
          const { main: installMain } =
            await import("@/cli/commands/install/install.js");
          await installMain({
            nonInteractive: true,
            installDir: dir,
            agent: agentName,
            silent: true,
            skillset: pName,
            ...(skipManifest ? { skipManifest: true } : {}),
          });
        },
        onRedownload: redownloadEnabled
          ? async ({ skillsetName: pName }) => {
              const { registryDownloadMain } =
                await import("@/cli/commands/registry-download/registryDownload.js");
              await registryDownloadMain({
                packageSpec: pName,
              });
            }
          : undefined,
        onReadFileDiff: async ({ relativePath, installDir: dir }) => {
          const currentConfig = await loadConfig();
          const currentProfileName =
            currentConfig != null
              ? getActiveSkillset({ config: currentConfig })
              : null;
          if (currentProfileName == null) return null;

          const resolvedDiffAgentNames = getDefaultAgents({
            config: currentConfig,
            agentOverride,
          });
          const diffAgent = AgentRegistry.getInstance().get({
            name: resolvedDiffAgentNames[0],
          });
          const agentDir = diffAgent.getAgentDir({ installDir: dir });
          const currentPath = path.join(agentDir, relativePath);
          const profileDir = path.join(
            getNoriSkillsetsDir(),
            currentProfileName,
          );

          // Map installed path back to profile source path
          let sourcePath: string | null = null;
          if (relativePath.startsWith("skills/")) {
            sourcePath = path.join(profileDir, relativePath);
          } else if (relativePath.startsWith("commands/")) {
            sourcePath = path.join(
              profileDir,
              "slashcommands",
              relativePath.slice("commands/".length),
            );
          } else if (relativePath.startsWith("agents/")) {
            // Check flat file first, then directory-based subagent
            const flatPath = path.join(
              profileDir,
              "subagents",
              relativePath.slice("agents/".length),
            );
            const agentFileName = relativePath.slice("agents/".length);
            const ext = path.extname(agentFileName);
            const agentName = ext
              ? agentFileName.slice(0, -ext.length)
              : agentFileName;
            const dirPath = path.join(
              profileDir,
              "subagents",
              agentName,
              "SUBAGENT.md",
            );

            try {
              await fs.access(flatPath);
              sourcePath = flatPath;
            } catch {
              try {
                await fs.access(dirPath);
                sourcePath = dirPath;
              } catch {
                // Neither exists
              }
            }
          }

          if (sourcePath == null) return null;

          try {
            const [currentContent, sourceContent] = await Promise.all([
              fs.readFile(currentPath, "utf-8"),
              fs.readFile(sourcePath, "utf-8"),
            ]);

            // Apply template substitution to .md files (matches install behavior)
            const original = relativePath.endsWith(".md")
              ? substituteTemplatePaths({
                  content: sourceContent,
                  installDir: agentDir,
                })
              : sourceContent;

            return { original, current: currentContent };
          } catch {
            return null;
          }
        },
      },
    });

    // Persist activeSkillset to config unless this is a transient CLI override
    if (resolved.source !== "cli") {
      await updateConfig({ activeSkillset: name });
    }

    if (flowResult == null) {
      return { success: false, cancelled: true, message: "" };
    }

    return {
      success: true,
      cancelled: false,
      message: flowResult.statusMessage,
    };
  }

  // Non-interactive flow
  const nonInteractiveConfig = await loadConfig();
  const agentNames = getDefaultAgents({
    config: nonInteractiveConfig,
    agentOverride,
  });

  // Check for local changes before proceeding (check first agent's manifest)
  // Skip when --install-dir is explicitly provided to avoid false positives
  const firstAgentName = agentNames[0];
  const firstAgent = AgentRegistry.getInstance().get({ name: firstAgentName });
  const localChanges = skipManifest
    ? null
    : await detectLocalChanges({
        agent: firstAgent,
        installDir,
      });

  if (localChanges != null && !force) {
    throw new Error(
      `Local changes detected in installed skillset files. ` +
        `Cannot proceed in non-interactive mode. ` +
        `Modified: ${localChanges.modified.length}, Added: ${localChanges.added.length}, Deleted: ${localChanges.deleted.length}. ` +
        `Run interactively to choose how to handle these changes, or use --force to discard them.`,
    );
  }

  // Broadcast switch to all configured agents
  for (const agentName of agentNames) {
    const agent = AgentRegistry.getInstance().get({ name: agentName });

    try {
      // Delegate to agent's switchSkillset method
      await switchSkillsetOp({ agent, installDir, skillsetName: name });
    } catch (err) {
      // On failure, show available skillsets
      const profiles = await listSkillsets();
      if (profiles.length > 0) {
        log.error(`Available skillsets: ${profiles.join(", ")}`);
      }
      throw err;
    }

    // Run install in silent mode to regenerate files with new skillset
    const { main: installMain } =
      await import("@/cli/commands/install/install.js");
    await installMain({
      nonInteractive: true,
      installDir,
      agent: agentName,
      silent: true,
      skillset: name,
      ...(skipManifest ? { skipManifest: true } : {}),
    });
  }

  // Persist activeSkillset to config unless this is a transient CLI override
  if (resolved.source !== "cli") {
    await updateConfig({ activeSkillset: name });
  }

  return {
    success: true,
    cancelled: false,
    message: `Switched to skillset "${name}"`,
  };
};

/**
 * Register the 'switch-skillset' command with commander
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerSwitchSkillsetCommand = (args: {
  program: Command;
}): void => {
  const { program } = args;

  program
    .command("switch-skillset [name]")
    .description("Switch to a different skillset and reinstall")
    .option("-a, --agent <name>", "AI agent to switch skillset for")
    .option("--force", "Force switch even when local changes are detected")
    .action(
      async (
        name: string | undefined,
        options: { agent?: string; force?: boolean },
      ) => {
        await switchSkillsetAction({ name: name ?? null, options, program });
      },
    );
};
