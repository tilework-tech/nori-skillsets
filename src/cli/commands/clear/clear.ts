/**
 * Clear Command
 *
 * Removes all Nori-managed configuration from the install directory
 * and clears the active skillset from config.
 */

import { log } from "@clack/prompts";

import { loadConfig, saveConfig, getDefaultAgents } from "@/cli/config.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { resolveInstallDir } from "@/utils/path.js";

/**
 * Main function for the clear command
 * Removes all Nori-managed agent configs from the installDir
 * and clears the activeSkillset from the config.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory override
 * @param args.agent - Specific agent to clear (defaults to all configured agents)
 */
export const clearMain = async (args?: {
  installDir?: string | null;
  agent?: string | null;
}): Promise<void> => {
  const { installDir: cliInstallDir, agent } = args ?? {};

  const config = await loadConfig();

  if (config == null) {
    log.info("No Nori configuration found. Nothing to clear.");
    return;
  }

  const effectiveInstallDir = resolveInstallDir({
    cliInstallDir,
    config,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  });

  const agentNames = getDefaultAgents({ config, agentOverride: agent });

  for (const agentName of agentNames) {
    const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
    await agentImpl.removeSkillset({ installDir: effectiveInstallDir });
  }

  await saveConfig({
    username: config.auth?.username ?? null,
    password: config.auth?.password ?? null,
    refreshToken: config.auth?.refreshToken ?? null,
    organizationUrl: config.auth?.organizationUrl ?? null,
    organizations: config.auth?.organizations ?? null,
    isAdmin: config.auth?.isAdmin ?? null,
    sendSessionTranscript: config.sendSessionTranscript ?? null,
    autoupdate: config.autoupdate ?? null,
    version: config.version ?? null,
    transcriptDestination: config.transcriptDestination ?? null,
    defaultAgents: config.defaultAgents ?? null,
    garbageCollectTranscripts: config.garbageCollectTranscripts ?? null,
    activeSkillset: null,
    installDir: config.installDir,
  });

  log.success("Cleared all Nori-managed configuration.");
};
