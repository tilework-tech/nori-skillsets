/**
 * Clear Command
 *
 * Removes all Nori-managed configuration from the install directory
 * and clears the active skillset from config.
 */

import { log } from "@clack/prompts";

import { loadConfig, updateConfig, getDefaultAgents } from "@/cli/config.js";
import {
  preflightSkillsetRemovalAtExactInstallDir,
  removeSkillset,
  removeSkillsetAtExactInstallDir,
} from "@/cli/features/agentOperations.js";
import { AgentRegistry } from "@/cli/features/agentRegistry.js";
import { resolveInstallDir } from "@/utils/path.js";

/**
 * Main function for the clear command
 * Removes all Nori-managed agent configs from the installDir
 * and clears the activeSkillset from the config.
 *
 * @param args - Configuration arguments
 * @param args.installDir - Custom installation directory override
 * @param args.exactInstallDir - Limit cleanup to per-directory artifacts
 */
export const clearMain = async (args?: {
  installDir?: string | null;
  exactInstallDir?: boolean | null;
}): Promise<void> => {
  const { installDir: cliInstallDir, exactInstallDir } = args ?? {};

  if (
    exactInstallDir === true &&
    (cliInstallDir == null || cliInstallDir.trim() === "")
  ) {
    throw new Error("--exact-install-dir requires --install-dir");
  }

  const config = await loadConfig();

  if (config == null && exactInstallDir !== true) {
    log.info("No Nori configuration found. Nothing to clear.");
    return;
  }

  const effectiveInstallDir = resolveInstallDir({
    cliInstallDir,
    configInstallDir: config?.installDir,
    agentDirNames: AgentRegistry.getInstance().getAgentDirNames(),
  }).path;

  const registry = AgentRegistry.getInstance();
  const agents =
    exactInstallDir === true && config == null
      ? registry.getAll()
      : getDefaultAgents({ config }).map((agentName) =>
          registry.get({ name: agentName }),
        );

  if (exactInstallDir === true) {
    const plans = (
      await Promise.all(
        agents.map((agent) =>
          preflightSkillsetRemovalAtExactInstallDir({
            agent,
            installDir: effectiveInstallDir,
          }),
        ),
      )
    ).filter((plan) => plan != null);
    for (const plan of plans) {
      await removeSkillsetAtExactInstallDir({ plan });
    }
    log.success("Cleared all Nori-managed configuration.");
    return;
  }

  for (const agent of agents) {
    await removeSkillset({
      agent,
      installDir: effectiveInstallDir,
    });
  }

  await updateConfig({ activeSkillset: null });

  log.success("Cleared all Nori-managed configuration.");
};
