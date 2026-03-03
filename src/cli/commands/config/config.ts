/**
 * Config Command
 *
 * Interactive configuration of Nori settings.
 * Sets defaultAgents and installDir in .nori-config.json.
 * When installDir or defaultAgents change, prompts user about
 * installing the active skillset and cleaning up the old directory.
 */

import { log } from "@clack/prompts";

import {
  getActiveSkillset,
  getDefaultAgents,
  loadConfig,
  updateConfig,
} from "@/cli/config.js";
import {
  isInstalledAtDir,
  removeSkillset,
} from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { confirmAction } from "@/cli/prompts/confirm.js";
import { configFlow } from "@/cli/prompts/flows/config.js";
import { normalizeInstallDir } from "@/utils/path.js";

import type { CommandStatus } from "@/cli/commands/commandStatus.js";

/**
 * Check if two arrays of strings contain the same elements (order-independent)
 *
 * @param args - Configuration arguments
 * @param args.a - First array
 * @param args.b - Second array
 *
 * @returns True if the arrays contain the same elements
 */
const arraysEqual = (args: { a: Array<string>; b: Array<string> }): boolean => {
  const { a, b } = args;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
};

/**
 * Main config function
 *
 * Runs the interactive config flow and saves results to .nori-config.json.
 * After saving, detects changes to installDir and defaultAgents, and
 * prompts the user to install/clean up accordingly.
 *
 * @returns Command status indicating success or cancellation
 */
export const configMain = async (): Promise<CommandStatus> => {
  const result = await configFlow({
    callbacks: {
      onLoadConfig: async () => {
        const config = await loadConfig();
        return {
          currentAgents: config?.defaultAgents ?? null,
          currentInstallDir: config?.installDir ?? null,
          currentRedownloadOnSwitch: config?.redownloadOnSwitch ?? null,
        };
      },
      onResolveAgents: async () => {
        const registry = AgentRegistry.getInstance();
        return registry.list().map((name) => {
          const agent = registry.get({ name });
          return {
            name: agent.name,
            displayName: agent.displayName,
            description: agent.description,
          };
        });
      },
    },
  });

  if (result == null) {
    return {
      success: false,
      cancelled: true,
      message: "Configuration cancelled.",
    };
  }

  // Load existing config to preserve all other fields
  const existingConfig = await loadConfig();

  const normalizedInstallDir = normalizeInstallDir({
    installDir: result.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });

  // Detect what changed
  const oldInstallDir = existingConfig?.installDir ?? null;
  const oldAgents = existingConfig?.defaultAgents ?? null;
  const activeSkillset =
    existingConfig != null
      ? getActiveSkillset({ config: existingConfig })
      : null;

  const installDirChanged =
    oldInstallDir != null && normalizedInstallDir !== oldInstallDir;
  const agentsChanged =
    oldAgents != null &&
    !arraysEqual({ a: oldAgents, b: result.defaultAgents });

  // Save config first (regardless of prompt answers)
  await updateConfig({
    defaultAgents: result.defaultAgents,
    redownloadOnSwitch: result.redownloadOnSwitch,
    installDir: normalizedInstallDir,
  });

  // Handle installDir change prompts
  if (installDirChanged && activeSkillset != null) {
    let shouldInstall = false;
    let shouldCleanup = false;

    shouldInstall = await confirmAction({
      message: `Your active skillset is "${activeSkillset}". Install it to "${normalizedInstallDir}"?`,
      initialValue: true,
    });

    shouldCleanup = await confirmAction({
      message: `Remove Nori-managed configuration from "${oldInstallDir}"? (If not, you may encounter conflicts if you switch back to this directory later.)`,
      initialValue: false,
    });

    // Clean up old directory first (while manifest still reflects old dir)
    if (shouldCleanup) {
      const allAgents = AgentRegistry.getInstance().getAll();
      for (const agent of allAgents) {
        if (isInstalledAtDir({ agent, path: oldInstallDir })) {
          await removeSkillset({ agent, installDir: oldInstallDir });
        }
      }
      log.info(`Removed Nori configuration from "${oldInstallDir}".`);
    }

    // Then install to new directory (overwrites manifest with new dir hashes)
    if (shouldInstall) {
      const { main: installMain } =
        await import("@/cli/commands/install/install.js");
      const agentNames = getDefaultAgents({
        config: {
          ...existingConfig,
          installDir: normalizedInstallDir,
          defaultAgents: result.defaultAgents,
        },
      });
      for (const agentName of agentNames) {
        await installMain({
          installDir: normalizedInstallDir,
          agent: agentName,
          silent: true,
        });
      }
      log.success(
        `Installed "${activeSkillset}" to "${normalizedInstallDir}".`,
      );
    }
  } else if (agentsChanged && activeSkillset != null) {
    // Handle defaultAgents change prompts (only when installDir didn't change)

    // Detect removed agents
    const removedAgents = oldAgents.filter(
      (a) => !result.defaultAgents.includes(a),
    );

    // Detect added agents
    const addedAgents = result.defaultAgents.filter(
      (a) => !oldAgents.includes(a),
    );

    // Clean up removed agents
    if (removedAgents.length > 0) {
      const shouldCleanup = await confirmAction({
        message: `Remove Nori-managed configuration for removed agent(s) (${removedAgents.join(", ")}) at "${normalizedInstallDir}"?`,
        initialValue: false,
      });

      if (shouldCleanup) {
        for (const agentName of removedAgents) {
          const agent = AgentRegistry.getInstance().get({ name: agentName });
          await removeSkillset({ agent, installDir: normalizedInstallDir });
        }
        log.info(
          `Removed configuration for ${removedAgents.join(", ")} at "${normalizedInstallDir}".`,
        );
      }
    }

    // Install for added agents
    if (addedAgents.length > 0) {
      const shouldInstall = await confirmAction({
        message: `Your active skillset is "${activeSkillset}". Install it for the new agent(s) at "${normalizedInstallDir}"?`,
        initialValue: true,
      });

      if (shouldInstall) {
        const { main: installMain } =
          await import("@/cli/commands/install/install.js");
        for (const agentName of addedAgents) {
          await installMain({
            installDir: normalizedInstallDir,
            agent: agentName,
            silent: true,
          });
        }
        log.success(
          `Installed "${activeSkillset}" for new agent(s) at "${normalizedInstallDir}".`,
        );
      }
    }
  }

  return { success: true, cancelled: false, message: "Configuration saved." };
};
