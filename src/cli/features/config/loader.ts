/**
 * Config file loader
 * Manages the .nori-config.json file lifecycle
 */

import * as os from "os";

import { signInWithEmailAndPassword, AuthErrorCodes } from "firebase/auth";

import { getConfigPath, loadConfig, saveConfig } from "@/cli/config.js";
import { info, success, error, warn, debug } from "@/cli/logger.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { configureFirebase, getFirebase } from "@/providers/firebase.js";

import type { Config, AgentConfig, ConfigAgentName } from "@/cli/config.js";
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
  // Use os.homedir() since this writes to global config
  const existingConfig = await loadConfig({ startDir: os.homedir() });

  // Extract auth credentials from config
  const username = config.auth?.username ?? null;
  const password = config.auth?.password ?? null;
  const refreshToken = config.auth?.refreshToken ?? null;
  const organizationUrl = config.auth?.organizationUrl ?? null;

  const sendSessionTranscript = config.sendSessionTranscript ?? null;

  // Merge agents from existing config and new config
  // The keys of the agents object indicate which agents are installed
  const mergedAgents: { [key in ConfigAgentName]?: AgentConfig } = {
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

      // Don't halt installation - continue without authentication
      warn({
        message:
          "  Continuing installation without authentication. Backend features will be unavailable.",
      });
    }
  }

  // Get current package version to save in config
  const currentVersion = getCurrentPackageVersion();

  // Preserve organizations, isAdmin, and transcriptDestination from existing config
  const organizations =
    config.auth?.organizations ?? existingConfig?.auth?.organizations ?? null;
  const isAdmin = config.auth?.isAdmin ?? existingConfig?.auth?.isAdmin ?? null;
  const transcriptDestination =
    config.transcriptDestination ??
    existingConfig?.transcriptDestination ??
    null;

  // Save config to disk with refresh token (not password)
  // This ensures we never store passwords, only secure tokens
  await saveConfig({
    username,
    refreshToken: tokenToSave,
    organizationUrl,
    organizations,
    isAdmin,
    agents: Object.keys(mergedAgents).length > 0 ? mergedAgents : null,
    sendSessionTranscript,
    autoupdate: existingConfig?.autoupdate,
    version: currentVersion,
    transcriptDestination,
    installDir: config.installDir,
  });

  const configPath = getConfigPath();
  success({ message: `✓ Config file created: ${configPath}` });
  if (currentVersion != null) {
    success({ message: `✓ Version ${currentVersion} saved to config` });
  }
};

/**
 * Config loader
 */
export const configLoader: Loader = {
  name: "config",
  description: "Configuration file (.nori-config.json)",
  run: installConfig,
};
