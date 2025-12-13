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
} from "@/cli/config.js";
import { info, success, error, debug } from "@/cli/logger.js";
import {
  getVersionFilePath,
  saveInstalledVersion,
  getCurrentPackageVersion,
} from "@/cli/version.js";
import { configureFirebase, getFirebase } from "@/providers/firebase.js";

import type { Config } from "@/cli/config.js";
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

  // Merge and dedupe installedAgents from existing config and new config
  const existingAgents = existingConfig?.installedAgents ?? [];
  const newAgents = config.installedAgents ?? [];
  const mergedAgents = [...new Set([...existingAgents, ...newAgents])];

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

  // Save config to disk with refresh token (not password)
  // This ensures we never store passwords, only secure tokens
  await saveConfig({
    username,
    refreshToken: tokenToSave,
    organizationUrl,
    profile: config.profile ?? null,
    agents: config.agents ?? existingConfig?.agents ?? null,
    sendSessionTranscript,
    autoupdate: existingConfig?.autoupdate,
    registryAuths:
      config.registryAuths ?? existingConfig?.registryAuths ?? null,
    installedAgents: mergedAgents.length > 0 ? mergedAgents : null,
    installDir: config.installDir,
  });

  const configPath = getConfigPath({ installDir: config.installDir });
  success({ message: `✓ Config file created: ${configPath}` });

  // Create version file to track installed version
  const currentVersion = getCurrentPackageVersion();
  if (currentVersion != null) {
    saveInstalledVersion({
      version: currentVersion,
      installDir: config.installDir,
    });
    const versionFilePath = getVersionFilePath({
      installDir: config.installDir,
    });
    success({ message: `✓ Version file created: ${versionFilePath}` });
  } else {
    info({
      message: "Could not determine package version, skipping version file",
    });
  }
};

/**
 * Remove the version file if it exists
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 */
const removeVersionFile = (args: { installDir: string }): void => {
  const { installDir } = args;
  const versionFile = getVersionFilePath({ installDir });

  if (existsSync(versionFile)) {
    unlinkSync(versionFile);
    success({ message: `✓ Version file removed: ${versionFile}` });
  }
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
    removeVersionFile({ installDir: config.installDir });
    return;
  }

  // Remove the agents being uninstalled from the list
  const agentsToRemove = config.installedAgents ?? [];
  const remainingAgents = existingConfig.installedAgents.filter(
    (agent) => !agentsToRemove.includes(agent),
  );

  // If no agents remain, delete the config file and version file
  if (remainingAgents.length === 0) {
    unlinkSync(configFile);
    success({ message: `✓ Config file removed: ${configFile}` });
    removeVersionFile({ installDir: config.installDir });
    return;
  }

  // Otherwise, update the config with remaining agents (preserve version file)
  await saveConfig({
    username: existingConfig.auth?.username ?? null,
    refreshToken: existingConfig.auth?.refreshToken ?? null,
    organizationUrl: existingConfig.auth?.organizationUrl ?? null,
    profile: existingConfig.profile ?? null,
    agents: existingConfig.agents ?? null,
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
  description: "Configuration file (.nori-config.json)",
  run: installConfig,
  uninstall: uninstallConfig,
};
