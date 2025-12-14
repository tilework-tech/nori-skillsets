/**
 * Config file loader
 * Manages the .nori-config.json file lifecycle
 */

import { unlinkSync, existsSync } from "fs";

import { signInWithEmailAndPassword, AuthErrorCodes } from "firebase/auth";

import {
  getConfigPath,
  loadConfig,
  saveConfig,
  isPaidInstall,
  getInstalledAgents,
} from "@/cli/config.js";
import { info, success, error, debug } from "@/cli/logger.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { configureFirebase, getFirebase } from "@/providers/firebase.js";

import type { Config, AgentConfig } from "@/cli/config.js";
import type { Loader } from "@/cli/features/agentRegistry.js";
import type { AuthError } from "firebase/auth";

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
  const refreshToken = config.auth?.refreshToken ?? null;
  const organizationUrl = config.auth?.organizationUrl ?? null;

  // Only include sendSessionTranscript for paid users
  // Free users should not have this field in their config
  const sendSessionTranscript = isPaidInstall({ config })
    ? (config.sendSessionTranscript ?? null)
    : null;

  // Merge agents from existing config and new config
  // The keys of the agents object indicate which agents are installed
  const mergedAgents: Record<string, AgentConfig> = {
    ...(existingConfig?.agents ?? {}),
    ...(config.agents ?? {}),
  };

  // If we have password but no refresh token, authenticate to get a refresh token
  // This converts password-based login to token-based storage
  let tokenToSave = refreshToken;
  if (password && !refreshToken && username) {
    info({ message: "Authenticating to obtain secure token..." });
    debug({ message: `  Email: ${username}` });
    debug({ message: `  Organization URL: ${organizationUrl}` });

    try {
      configureFirebase();
      const firebase = getFirebase();
      debug({
        message: `  Firebase project: ${firebase.app.options.projectId}`,
      });

      const userCredential = await signInWithEmailAndPassword(
        firebase.auth,
        username,
        password,
      );
      tokenToSave = userCredential.user.refreshToken;
      success({ message: "✓ Authentication successful" });
    } catch (err) {
      const authError = err as AuthError;
      error({ message: "Authentication failed" });
      error({ message: `  Email: ${username}` });
      error({ message: `  Error code: ${authError.code}` });
      error({ message: `  Error message: ${authError.message}` });

      // Provide helpful hints based on error code
      if (
        authError.code === AuthErrorCodes.INVALID_PASSWORD ||
        authError.code === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS ||
        authError.code === "auth/invalid-credential"
      ) {
        error({
          message:
            "  Hint: Check that your email and password are correct for the Nori backend",
        });
      } else if (authError.code === AuthErrorCodes.USER_DELETED) {
        error({
          message: "  Hint: This email is not registered. Contact support.",
        });
      } else if (
        authError.code === AuthErrorCodes.TOO_MANY_ATTEMPTS_TRY_LATER
      ) {
        error({
          message:
            "  Hint: Too many failed attempts. Wait a few minutes and try again.",
        });
      } else if (authError.code === AuthErrorCodes.NETWORK_REQUEST_FAILED) {
        error({
          message: "  Hint: Network error. Check your internet connection.",
        });
      }

      throw err;
    }
  }

  // Get current package version to save in config
  const currentVersion = getCurrentPackageVersion();

  // Save config to disk with refresh token (not password)
  // This ensures we never store passwords, only secure tokens
  await saveConfig({
    username,
    refreshToken: tokenToSave,
    organizationUrl,
    agents: Object.keys(mergedAgents).length > 0 ? mergedAgents : null,
    sendSessionTranscript,
    autoupdate: existingConfig?.autoupdate,
    registryAuths:
      config.registryAuths ?? existingConfig?.registryAuths ?? null,
    version: currentVersion,
    installDir: config.installDir,
  });

  const configPath = getConfigPath({ installDir: config.installDir });
  success({ message: `✓ Config file created: ${configPath}` });
  if (currentVersion != null) {
    success({ message: `✓ Version ${currentVersion} saved to config` });
  }
};

/**
 * Uninstall config file - remove agent from agents object or delete file
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration (agents contains agents being uninstalled)
 */
const uninstallConfig = async (args: { config: Config }): Promise<void> => {
  const { config } = args;
  const configFile = getConfigPath({ installDir: config.installDir });

  if (!existsSync(configFile)) {
    info({ message: "Config file not found (may not exist)" });
    return;
  }

  // Load existing config to check agents
  const existingConfig = await loadConfig({
    installDir: config.installDir,
  });

  // Get installed agents from the agents object
  const installedAgents = existingConfig
    ? getInstalledAgents({ config: existingConfig })
    : [];

  // If no agents in existing config, delete the entire file
  if (installedAgents.length === 0) {
    unlinkSync(configFile);
    success({ message: `✓ Config file removed: ${configFile}` });
    return;
  }

  // Determine which agents are being uninstalled
  const agentsToRemove = config.agents ? Object.keys(config.agents) : [];

  // Create new agents object without the agents being uninstalled
  const remainingAgentsObj: Record<string, AgentConfig> = {};
  for (const agentName of installedAgents) {
    if (!agentsToRemove.includes(agentName) && existingConfig?.agents) {
      remainingAgentsObj[agentName] = existingConfig.agents[agentName];
    }
  }

  const remainingAgentNames = Object.keys(remainingAgentsObj);

  // If no agents remain, delete the config file
  if (remainingAgentNames.length === 0) {
    unlinkSync(configFile);
    success({ message: `✓ Config file removed: ${configFile}` });
    return;
  }

  // Otherwise, update the config with remaining agents (preserve version)
  await saveConfig({
    username: existingConfig?.auth?.username ?? null,
    refreshToken: existingConfig?.auth?.refreshToken ?? null,
    organizationUrl: existingConfig?.auth?.organizationUrl ?? null,
    sendSessionTranscript: existingConfig?.sendSessionTranscript ?? null,
    autoupdate: existingConfig?.autoupdate ?? null,
    registryAuths: existingConfig?.registryAuths ?? null,
    agents: remainingAgentsObj,
    version: existingConfig?.version ?? null,
    installDir: config.installDir,
  });

  success({
    message: `✓ Agent removed from config. Remaining agents: ${remainingAgentNames.join(", ")}`,
  });
};

/**
 * Config loader
 */
export const configLoader: Loader = {
  name: "config",
  description: "Configuration file (.nori-config.json)",
  run: installConfig,
  uninstall: uninstallConfig,
};
