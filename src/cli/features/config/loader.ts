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
    installDir: config.installDir,
  });

  const configPath = getConfigPath({ installDir: config.installDir });
  success({ message: `✓ Config file created: ${configPath}` });
};

/**
 * Uninstall config file - remove it
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const uninstallConfig = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const configFile = getConfigPath({ installDir: config.installDir });

  if (existsSync(configFile)) {
    unlinkSync(configFile);
    success({ message: `✓ Config file removed: ${configFile}` });
  } else {
    info({ message: "Config file not found (may not exist)" });
  }
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
