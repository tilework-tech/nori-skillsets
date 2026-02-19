/**
 * Config Command
 *
 * Interactive configuration of Nori settings.
 * Sets defaultAgents and installDir in .nori-config.json.
 */

import { outro } from "@clack/prompts";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { configFlow } from "@/cli/prompts/flows/config.js";
import { normalizeInstallDir } from "@/utils/path.js";

/**
 * Main config function
 *
 * Runs the interactive config flow and saves results to .nori-config.json.
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

  await saveConfig({
    username: existingConfig?.auth?.username ?? null,
    refreshToken: existingConfig?.auth?.refreshToken ?? null,
    password: existingConfig?.auth?.password ?? null,
    organizationUrl: existingConfig?.auth?.organizationUrl ?? null,
    organizations: existingConfig?.auth?.organizations ?? null,
    isAdmin: existingConfig?.auth?.isAdmin ?? null,
    sendSessionTranscript: existingConfig?.sendSessionTranscript ?? null,
    autoupdate: existingConfig?.autoupdate ?? null,
    agents: existingConfig?.agents ?? null,
    version: existingConfig?.version ?? null,
    transcriptDestination: existingConfig?.transcriptDestination ?? null,
    defaultAgents: result.defaultAgents,
    installDir: normalizedInstallDir,
  });

  outro("Configuration saved.");
};
