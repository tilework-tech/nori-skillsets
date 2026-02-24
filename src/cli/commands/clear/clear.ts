/**
 * Clear Command
 *
 * Removes all Nori-managed configuration from the install directory
 * and clears the active skillset from config.
 */

import { log } from "@clack/prompts";

import { loadConfig, updateConfig, getDefaultAgents } from "@/cli/config.js";
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
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  }).path;

  const agentNames = getDefaultAgents({ config, agentOverride: agent });

  for (const agentName of agentNames) {
    const agentImpl = AgentRegistry.getInstance().get({ name: agentName });
    await agentImpl.removeSkillset({ installDir: effectiveInstallDir });
  }

  await updateConfig({ activeSkillset: null });

  log.success("Cleared all Nori-managed configuration.");
};
