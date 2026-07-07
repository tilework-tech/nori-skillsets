/**
 * Config Command
 *
 * Configuration of Nori settings, either interactively or via CLI options.
 * Sets defaultAgents, installDir, redownloadOnSwitch, and
 * claudeCodeStatusLine in .nori-config.json.
 * When installDir or defaultAgents change in interactive mode, prompts user
 * about installing the active skillset and cleaning up the old directory.
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
import { main as installMain } from "@/cli/features/install/install.js";
import { confirmAction } from "@/cli/prompts/confirm.js";
import { configFlow } from "@/cli/prompts/flows/config.js";
import { normalizeInstallDir } from "@/utils/path.js";
import { isValidOrgId } from "@/utils/url.js";

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
 * Parse and validate a comma-separated agents string
 *
 * @param args - Arguments
 * @param args.agents - Comma-separated agent names
 *
 * @throws {Error} If no agent names provided or if any agent name is invalid
 *
 * @returns Array of validated agent names
 */
const parseAgents = (args: { agents: string }): Array<string> => {
  const { agents } = args;
  const agentNames = agents
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  if (agentNames.length === 0) {
    throw new Error(
      "No agent names provided. Use a comma-separated list (e.g., --agents claude-code,cursor).",
    );
  }

  const registry = AgentRegistry.getInstance();
  for (const name of agentNames) {
    registry.get({ name });
  }

  return agentNames;
};

/**
 * Interpret a `--default-org` value. An empty value clears the setting; any
 * other value must be a valid org ID.
 *
 * @param args - Arguments
 * @param args.defaultOrg - The raw `--default-org` value
 *
 * @throws {Error} If the value is a non-empty invalid org ID
 *
 * @returns The org ID to persist, or null to clear the setting
 */
const parseDefaultOrgOption = (args: { defaultOrg: string }): string | null => {
  const { defaultOrg } = args;
  const trimmed = defaultOrg.trim();
  if (trimmed === "") {
    return null;
  }
  if (!isValidOrgId({ orgId: trimmed })) {
    throw new Error(
      `Invalid organization "${defaultOrg}". Org IDs are lowercase alphanumeric with single hyphens (e.g., my-org).`,
    );
  }
  return trimmed;
};

/**
 * Main config function
 *
 * When CLI options are provided (agents, installDir, redownloadOnSwitch,
 * claudeCodeStatusLine),
 * applies them directly without interactive prompts.
 * Otherwise, runs the interactive config flow and saves results to
 * .nori-config.json. After saving in interactive mode, detects changes
 * to installDir and defaultAgents, and prompts the user to install/clean
 * up accordingly.
 *
 * @param args - Optional CLI arguments for non-interactive mode
 * @param args.agents - Comma-separated agent names
 * @param args.installDir - Install directory path
 * @param args.redownloadOnSwitch - Whether to prompt for re-download on switch
 * @param args.claudeCodeStatusLine - Whether Claude Code apply configures status line
 * @param args.defaultOrg - Default org for bare package names ("" to clear)
 * @param args.nonInteractive - Force non-interactive mode
 *
 * @returns Command status indicating success or cancellation
 */
export const configMain = async (
  args?: {
    agents?: string | null;
    installDir?: string | null;
    redownloadOnSwitch?: boolean | null;
    claudeCodeStatusLine?: boolean | null;
    defaultOrg?: string | null;
    nonInteractive?: boolean | null;
  } | null,
): Promise<CommandStatus> => {
  const {
    agents,
    installDir,
    redownloadOnSwitch,
    claudeCodeStatusLine,
    defaultOrg,
    nonInteractive,
  } = args ?? {};

  const hasOptions =
    agents != null ||
    installDir != null ||
    redownloadOnSwitch != null ||
    claudeCodeStatusLine != null ||
    defaultOrg != null;

  if (hasOptions || nonInteractive) {
    if (!hasOptions) {
      throw new Error(
        "No configuration options provided. Use --agents, --install-dir, --redownload-on-switch, --claude-code-status-line, or --default-org.",
      );
    }

    const update: {
      defaultAgents?: Array<string>;
      installDir?: string;
      redownloadOnSwitch?: "enabled" | "disabled";
      claudeCodeStatusLine?: "enabled" | "disabled";
      defaultOrg?: string | null;
    } = {};

    if (agents != null) {
      update.defaultAgents = parseAgents({ agents });
    }

    if (installDir != null) {
      update.installDir = normalizeInstallDir({
        installDir,
        agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
      });
    }

    if (redownloadOnSwitch != null) {
      update.redownloadOnSwitch = redownloadOnSwitch ? "enabled" : "disabled";
    }

    if (claudeCodeStatusLine != null) {
      update.claudeCodeStatusLine = claudeCodeStatusLine
        ? "enabled"
        : "disabled";
    }

    if (defaultOrg != null) {
      // An empty value clears the setting; otherwise validate the org ID.
      update.defaultOrg = parseDefaultOrgOption({ defaultOrg });
    }

    await updateConfig(update);

    return { success: true, cancelled: false, message: "Configuration saved" };
  }

  const result = await configFlow({
    callbacks: {
      onLoadConfig: async () => {
        const config = await loadConfig();
        return {
          currentAgents: config?.defaultAgents ?? null,
          currentInstallDir: config?.installDir ?? null,
          currentRedownloadOnSwitch: config?.redownloadOnSwitch ?? null,
          currentClaudeCodeStatusLine: config?.claudeCodeStatusLine ?? null,
          currentDefaultOrg: config?.defaultOrg ?? null,
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
            supportTier: agent.supportTier,
          };
        });
      },
    },
  });

  if (result == null) {
    return {
      success: false,
      cancelled: true,
      message: "Configuration cancelled",
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
  const configUpdate: {
    defaultAgents: Array<string>;
    redownloadOnSwitch: "enabled" | "disabled";
    claudeCodeStatusLine?: "enabled" | "disabled";
    defaultOrg: string | null;
    installDir: string;
  } = {
    defaultAgents: result.defaultAgents,
    redownloadOnSwitch: result.redownloadOnSwitch,
    defaultOrg: result.defaultOrg ?? null,
    installDir: normalizedInstallDir,
  };

  if (result.claudeCodeStatusLine != null) {
    configUpdate.claudeCodeStatusLine = result.claudeCodeStatusLine;
  }

  await updateConfig(configUpdate);

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
      const agentNames = getDefaultAgents({
        config: {
          ...existingConfig,
          installDir: normalizedInstallDir,
          defaultAgents: result.defaultAgents,
        },
        agentOverride: null,
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

  return { success: true, cancelled: false, message: "Configuration saved" };
};
