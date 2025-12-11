/**
 * Config file loader
 * Manages the .nori-config.json file lifecycle
 */

import { unlinkSync, existsSync } from "fs";

import {
  getConfigPath,
  loadConfig,
  saveConfig,
  isPaidInstall,
} from "@/cli/config.js";
import { info, success } from "@/cli/logger.js";

import type { Config } from "@/cli/config.js";
import type { Loader } from "@/cli/features/agentRegistry.js";

/**
 * Install config file - save config to disk
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installConfig = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  // Load existing config to preserve user preferences (sendSessionTranscript, autoupdate)
  const existingConfig = await loadConfig({
    installDir: config.installDir,
  });

  // Extract auth credentials from config
  const username = config.auth?.username ?? null;
  const password = config.auth?.password ?? null;
  const organizationUrl = config.auth?.organizationUrl ?? null;

  // Only include sendSessionTranscript for paid users
  // Free users should not have this field in their config
  const sendSessionTranscript = isPaidInstall({ config })
    ? (config.sendSessionTranscript ?? null)
    : null;

  // Merge and dedupe installedAgents from existing config and new config
  const existingAgents = existingConfig?.installedAgents ?? [];
  const newAgents = config.installedAgents ?? [];
  const mergedAgents = [...new Set([...existingAgents, ...newAgents])];

  // Save config to disk, preserving existing user preferences
  await saveConfig({
    username,
    password,
    organizationUrl,
    profile: config.profile ?? null,
    sendSessionTranscript,
    autoupdate: existingConfig?.autoupdate,
    registryAuths:
      config.registryAuths ?? existingConfig?.registryAuths ?? null,
    installedAgents: mergedAgents.length > 0 ? mergedAgents : null,
    installDir: config.installDir,
  });

  const configPath = getConfigPath({ installDir: config.installDir });
  success({ message: `✓ Config file created: ${configPath}` });
};

/**
 * Uninstall config file - remove agent from installedAgents or delete file
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration (installedAgents contains agents being uninstalled)
 */
const uninstallConfig = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const configFile = getConfigPath({ installDir: config.installDir });

  if (!existsSync(configFile)) {
    info({ message: "Config file not found (may not exist)" });
    return;
  }

  // Load existing config to check installedAgents
  const existingConfig = await loadConfig({
    installDir: config.installDir,
  });

  // If no installedAgents field in existing config (legacy), delete the entire file
  if (existingConfig?.installedAgents == null) {
    unlinkSync(configFile);
    success({ message: `✓ Config file removed: ${configFile}` });
    return;
  }

  // Remove the agents being uninstalled from the list
  const agentsToRemove = config.installedAgents ?? [];
  const remainingAgents = existingConfig.installedAgents.filter(
    (agent) => !agentsToRemove.includes(agent),
  );

  // If no agents remain, delete the config file
  if (remainingAgents.length === 0) {
    unlinkSync(configFile);
    success({ message: `✓ Config file removed: ${configFile}` });
    return;
  }

  // Otherwise, update the config with remaining agents
  await saveConfig({
    username: existingConfig.auth?.username ?? null,
    password: existingConfig.auth?.password ?? null,
    organizationUrl: existingConfig.auth?.organizationUrl ?? null,
    profile: existingConfig.profile ?? null,
    sendSessionTranscript: existingConfig.sendSessionTranscript ?? null,
    autoupdate: existingConfig.autoupdate ?? null,
    registryAuths: existingConfig.registryAuths ?? null,
    installedAgents: remainingAgents,
    installDir: config.installDir,
  });

  success({
    message: `✓ Agent removed from config. Remaining agents: ${remainingAgents.join(", ")}`,
  });
};

/**
 * Config loader
 */
export const configLoader: Loader = {
  name: "config",
  description: "Manage .nori-config.json file",
  run: installConfig,
  uninstall: uninstallConfig,
};
