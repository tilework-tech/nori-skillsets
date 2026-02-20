/**
 * Config Command
 *
 * Interactive configuration of Nori settings.
 * Sets defaultAgents and installDir in .nori-config.json.
 * When installDir or defaultAgents change, prompts user about
 * installing the active skillset and cleaning up the old directory.
 */

import { log, outro } from "@clack/prompts";

import {
  getActiveSkillset,
  getDefaultAgents,
  loadConfig,
  saveConfig,
} from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { getClaudeDir } from "@/cli/features/claude-code/paths.js";
import {
  getManifestPath,
  getLegacyManifestPath,
  removeManagedFiles,
} from "@/cli/features/claude-code/skillsets/manifest.js";
import { confirmAction } from "@/cli/prompts/confirm.js";
import { configFlow } from "@/cli/prompts/flows/config.js";
import { normalizeInstallDir } from "@/utils/path.js";

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
 */
export const configMain = async (): Promise<void> => {
  const result = await configFlow({
    callbacks: {
      onLoadConfig: async () => {
        const config = await loadConfig();
        return {
          currentAgents: config?.defaultAgents ?? null,
          currentInstallDir: config?.installDir ?? null,
        };
      },
      onResolveAgents: async () => {
        const registry = AgentRegistry.getInstance();
        return registry.list().map((name) => {
          const agent = registry.get({ name });
          return { name: agent.name, displayName: agent.displayName };
        });
      },
    },
  });

  if (result == null) return;

  // Load existing config to preserve all other fields
  const existingConfig = await loadConfig();

  const normalizedInstallDir = normalizeInstallDir({
    installDir: result.installDir,
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
  await saveConfig({
    username: existingConfig?.auth?.username ?? null,
    refreshToken: existingConfig?.auth?.refreshToken ?? null,
    password: existingConfig?.auth?.password ?? null,
    organizationUrl: existingConfig?.auth?.organizationUrl ?? null,
    organizations: existingConfig?.auth?.organizations ?? null,
    isAdmin: existingConfig?.auth?.isAdmin ?? null,
    sendSessionTranscript: existingConfig?.sendSessionTranscript ?? null,
    autoupdate: existingConfig?.autoupdate ?? null,
    activeSkillset: existingConfig?.activeSkillset ?? null,
    version: existingConfig?.version ?? null,
    transcriptDestination: existingConfig?.transcriptDestination ?? null,
    defaultAgents: result.defaultAgents,
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
      const claudeDir = getClaudeDir({ installDir: oldInstallDir });
      const agentNames = getDefaultAgents({ config: existingConfig });
      for (const agentName of agentNames) {
        const agent = AgentRegistry.getInstance().get({ name: agentName });
        const manifestPath = getManifestPath({ agentName });
        await removeManagedFiles({
          claudeDir,
          manifestPath,
          managedDirs: agent.getManagedDirs(),
        });
      }
      // Also try cleaning up legacy manifest
      const legacyPath = getLegacyManifestPath();
      await removeManagedFiles({ claudeDir, manifestPath: legacyPath });
      log.info(`Removed Nori configuration from "${oldInstallDir}".`);
    }

    // Then install to new directory (overwrites manifest with new dir hashes)
    if (shouldInstall) {
      const { main: installMain } =
        await import("@/cli/commands/install/install.js");
      await installMain({
        installDir: normalizedInstallDir,
        silent: true,
      });
      log.success(
        `Installed "${activeSkillset}" to "${normalizedInstallDir}".`,
      );
    }
  } else if (agentsChanged && activeSkillset != null) {
    // Handle defaultAgents change prompts (only when installDir didn't change)
    const shouldInstall = await confirmAction({
      message: `Your active skillset is "${activeSkillset}". Install it for the new agent(s) at "${normalizedInstallDir}"?`,
      initialValue: true,
    });

    if (shouldInstall) {
      const { main: installMain } =
        await import("@/cli/commands/install/install.js");
      await installMain({
        installDir: normalizedInstallDir,
        silent: true,
      });
      log.success(
        `Installed "${activeSkillset}" for new agent(s) at "${normalizedInstallDir}".`,
      );
    }
  }

  outro("Configuration saved.");
};
