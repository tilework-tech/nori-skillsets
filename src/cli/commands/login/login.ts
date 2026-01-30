/**
 * Login Command
 *
 * Authenticates users against noriskillsets.dev and stores credentials.
 */

import * as os from "os";
import * as path from "path";

import { signInWithEmailAndPassword, AuthErrorCodes } from "firebase/auth";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { error, info, success, warn, newline } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { configureFirebase, getFirebase } from "@/providers/firebase.js";

import type { Command } from "commander";
import type { AuthError } from "firebase/auth";

/** The base URL for the noriskillsets.dev API */
const NORI_SKILLSETS_API_URL = "https://noriskillsets.dev";

/**
 * Response from the check-access endpoint
 */
type CheckAccessResponse = {
  authorized: boolean;
  organizations: Array<string>;
  isAdmin: boolean;
};

/**
 * Fetch user's organizations and admin status from the registrar
 *
 * @param args - Configuration arguments
 * @param args.idToken - Firebase ID token for authentication
 *
 * @returns Organizations and admin status, or null if request fails
 */
const fetchUserAccess = async (args: {
  idToken: string;
}): Promise<CheckAccessResponse | null> => {
  const { idToken } = args;

  try {
    const response = await fetch(
      `${NORI_SKILLSETS_API_URL}/api/auth/check-access`,
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as CheckAccessResponse;
  } catch {
    return null;
  }
};

/**
 * Main login function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.email - Email address (for non-interactive mode)
 * @param args.password - Password (for non-interactive mode)
 */
/** Default config directory for login/logout commands */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".nori");

export const loginMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  email?: string | null;
  password?: string | null;
}): Promise<void> => {
  const { installDir, nonInteractive, email, password } = args ?? {};
  // Default to ~/.nori for config storage
  const configDir = installDir ?? DEFAULT_CONFIG_DIR;

  // Get credentials
  let userEmail: string;
  let userPassword: string;

  if (nonInteractive) {
    // Non-interactive mode requires both email and password
    if (email == null || password == null) {
      error({
        message: "Non-interactive mode requires --email and --password flags.",
      });
      return;
    }
    userEmail = email;
    userPassword = password;
  } else {
    // Interactive mode - prompt for credentials
    userEmail = await promptUser({ prompt: "Email: " });
    if (!userEmail || userEmail.trim() === "") {
      error({ message: "Email is required." });
      return;
    }

    userPassword = await promptUser({ prompt: "Password: ", hidden: true });
    if (!userPassword) {
      error({ message: "Password is required." });
      return;
    }
  }

  // Authenticate with Firebase
  info({ message: "Authenticating..." });

  let refreshToken: string;
  let idToken: string;

  try {
    configureFirebase();
    const firebase = getFirebase();

    const userCredential = await signInWithEmailAndPassword(
      firebase.auth,
      userEmail,
      userPassword,
    );

    refreshToken = userCredential.user.refreshToken;
    idToken = await userCredential.user.getIdToken();
  } catch (err) {
    const authError = err as AuthError;
    error({ message: "Authentication failed" });
    error({ message: `  Error: ${authError.message}` });

    // Provide helpful hints based on error code
    if (
      authError.code === AuthErrorCodes.INVALID_PASSWORD ||
      authError.code === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS ||
      authError.code === "auth/invalid-credential"
    ) {
      error({
        message: "  Hint: Check that your email and password are correct.",
      });
    } else if (authError.code === AuthErrorCodes.USER_DELETED) {
      error({
        message: "  Hint: This email is not registered. Contact support.",
      });
    } else if (authError.code === AuthErrorCodes.TOO_MANY_ATTEMPTS_TRY_LATER) {
      error({
        message:
          "  Hint: Too many failed attempts. Wait a few minutes and try again.",
      });
    } else if (authError.code === AuthErrorCodes.NETWORK_REQUEST_FAILED) {
      error({
        message: "  Hint: Network error. Check your internet connection.",
      });
    }

    return;
  }

  // Fetch user's organizations and admin status
  let organizations: Array<string> = [];
  let isAdmin = false;

  const accessInfo = await fetchUserAccess({ idToken });

  if (accessInfo == null) {
    warn({
      message:
        "Could not fetch organization information. Saving credentials without organization data.",
    });
  } else {
    organizations = accessInfo.organizations;
    isAdmin = accessInfo.isAdmin;
  }

  // Load existing config to preserve other fields
  const existingConfig = await loadConfig({ installDir: configDir });

  // Save credentials to config
  await saveConfig({
    username: userEmail,
    refreshToken,
    organizationUrl: NORI_SKILLSETS_API_URL,
    organizations,
    isAdmin,
    sendSessionTranscript: existingConfig?.sendSessionTranscript ?? null,
    autoupdate: existingConfig?.autoupdate ?? null,
    registryAuths: existingConfig?.registryAuths ?? null,
    agents: existingConfig?.agents ?? null,
    version: existingConfig?.version ?? null,
    installDir: configDir,
  });

  newline();
  success({ message: `Logged in as ${userEmail}` });

  if (organizations.length > 0) {
    info({ message: `Organizations: ${organizations.join(", ")}` });
    if (isAdmin) {
      info({ message: "Admin: Yes" });
    }
  } else {
    info({ message: "No private organizations found. Using public registry." });
  }
};

/**
 * Register the 'login' command with commander
 *
 * @param args - Configuration arguments
 * @param args.program - Commander program instance
 */
export const registerLoginCommand = (args: { program: Command }): void => {
  const { program } = args;

  program
    .command("login")
    .description("Authenticate with noriskillsets.dev")
    .option("-e, --email <email>", "Email address (for non-interactive mode)")
    .option("-p, --password <password>", "Password (for non-interactive mode)")
    .action(async (options: { email?: string; password?: string }) => {
      const globalOpts = program.opts();

      await loginMain({
        installDir: globalOpts.installDir || null,
        nonInteractive: globalOpts.nonInteractive || null,
        email: options.email || null,
        password: options.password || null,
      });
    });
};
