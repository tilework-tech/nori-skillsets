/**
 * Config file loader
 * Manages the .nori-config.json file lifecycle
 */

import { log, note } from "@clack/prompts";
import { signInWithEmailAndPassword, AuthErrorCodes } from "firebase/auth";

import { getConfigPath, loadConfig, updateConfig } from "@/cli/config.js";
import { debug } from "@/cli/logger.js";
import { getCurrentPackageVersion } from "@/cli/version.js";
import { configureFirebase, getFirebase } from "@/providers/firebase.js";

import type { Config } from "@/cli/config.js";
import type { AgentLoader } from "@/cli/features/agentRegistry.js";
import type { AuthError } from "firebase/auth";

/**
 * Install config file - save config to disk
 * @param args - Configuration arguments
 * @param args.config - Runtime configuration
 */
const installConfig = async (args: { config: Config }): Promise<void> => {
  const { config } = args;

  // Load existing config to preserve user preferences (sendSessionTranscript, autoupdate)
  // Use getHomeDir() since this writes to global config
  const existingConfig = await loadConfig();

  // Extract auth credentials from config
  const username = config.auth?.username ?? null;
  const password = config.auth?.password ?? null;
  const refreshToken = config.auth?.refreshToken ?? null;
  const organizationUrl = config.auth?.organizationUrl ?? null;

  const sendSessionTranscript = config.sendSessionTranscript ?? null;

  // Preserve activeSkillset from existing config or new config
  const activeSkillset =
    config.activeSkillset ?? existingConfig?.activeSkillset ?? null;

  // If we have password but no refresh token, authenticate to get a refresh token
  // This converts password-based login to token-based storage
  let tokenToSave = refreshToken;
  if (password && !refreshToken && username) {
    log.info("Authenticating to obtain secure token...");
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
      log.success("Authentication successful");
    } catch (err) {
      const authError = err as AuthError;
      log.error("Authentication failed");

      // Consolidate detail lines into a note
      const details = [
        `Email: ${username}`,
        `Error code: ${authError.code}`,
        `Error message: ${authError.message}`,
      ];

      // Provide helpful hints based on error code
      if (
        authError.code === AuthErrorCodes.INVALID_PASSWORD ||
        authError.code === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS ||
        authError.code === "auth/invalid-credential"
      ) {
        details.push(
          "",
          "Hint: Check that your email and password are correct for the Nori backend",
        );
      } else if (authError.code === AuthErrorCodes.USER_DELETED) {
        details.push(
          "",
          "Hint: This email is not registered. Contact support.",
        );
      } else if (
        authError.code === AuthErrorCodes.TOO_MANY_ATTEMPTS_TRY_LATER
      ) {
        details.push(
          "",
          "Hint: Too many failed attempts. Wait a few minutes and try again.",
        );
      } else if (authError.code === AuthErrorCodes.NETWORK_REQUEST_FAILED) {
        details.push(
          "",
          "Hint: Network error. Check your internet connection.",
        );
      }

      note(details.join("\n"), "Details");

      // Don't halt installation - continue without authentication
      log.warn(
        "Continuing installation without authentication. Backend features will be unavailable.",
      );
    }
  }

  // Get current package version to save in config
  const currentVersion = getCurrentPackageVersion();

  // Build auth object if we have credentials
  const auth =
    username != null && organizationUrl != null
      ? {
          username,
          organizationUrl,
          refreshToken: tokenToSave,
          organizations:
            config.auth?.organizations ??
            existingConfig?.auth?.organizations ??
            null,
          isAdmin:
            config.auth?.isAdmin ?? existingConfig?.auth?.isAdmin ?? null,
        }
      : undefined;

  // Save config to disk with refresh token (not password)
  // This ensures we never store passwords, only secure tokens
  await updateConfig({
    ...(auth != null ? { auth } : {}),
    activeSkillset,
    sendSessionTranscript,
    version: currentVersion,
    transcriptDestination:
      config.transcriptDestination ??
      existingConfig?.transcriptDestination ??
      null,
  });

  const configPath = getConfigPath();
  log.success(`Config file created: ${configPath}`);
  if (currentVersion != null) {
    log.success(`Version ${currentVersion} saved to config`);
  }
};

/**
 * Config loader
 */
export const configLoader: AgentLoader = {
  name: "config",
  description: "Configuration file (.nori-config.json)",
  run: async ({ config }) => {
    await installConfig({ config });
  },
};
