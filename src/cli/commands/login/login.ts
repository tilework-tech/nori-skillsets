/**
 * Login Command
 *
 * Authenticates users against noriskillsets.dev and stores credentials.
 * Supports email/password and Google SSO authentication.
 */

import * as os from "os";
import * as path from "path";

import {
  signInWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  AuthErrorCodes,
} from "firebase/auth";
import open from "open";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { error, info, success, warn, newline } from "@/cli/logger.js";
import { promptUser } from "@/cli/prompt.js";
import { configureFirebase, getFirebase } from "@/providers/firebase.js";

import type { Command } from "commander";
import type { AuthError } from "firebase/auth";

import {
  exchangeCodeForTokens,
  findAvailablePort,
  generateState,
  getGoogleAuthUrl,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  startAuthServer,
  validateOAuthCredentials,
} from "./googleAuth.js";

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

/** Default config directory for login/logout commands */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".nori");

/**
 * Authenticate via Google SSO using the localhost OAuth callback pattern
 *
 * @returns Firebase credentials (refreshToken, idToken, email)
 */
const authenticateWithGoogle = async (): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
}> => {
  // Fail fast if OAuth credentials are not configured
  validateOAuthCredentials();

  // Find an available port for the callback server
  const port = await findAvailablePort({});
  const redirectUri = `http://localhost:${port}`;

  // Generate CSRF protection nonce
  const state = generateState();

  // Build the Google OAuth URL
  const authUrl = getGoogleAuthUrl({
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    redirectUri,
    state,
  });

  // Start the local server to capture the callback
  const serverPromise = startAuthServer({
    port,
    expectedState: state,
  });

  // Open browser to the Google consent screen
  info({ message: "Opening browser for Google authentication..." });
  try {
    await open(authUrl);
  } catch {
    // If browser fails to open, print the URL for manual copy-paste
    info({
      message: "Could not open browser automatically. Please visit:",
    });
    info({ message: `  ${authUrl}` });
  }

  // Wait for the OAuth callback
  const { code, server } = await serverPromise;
  server.close();

  // Exchange the authorization code for Google tokens
  info({ message: "Exchanging authorization code..." });
  const googleTokens = await exchangeCodeForTokens({
    code,
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri,
  });

  // Sign in to Firebase with the Google credential
  configureFirebase();
  const firebase = getFirebase();
  const credential = GoogleAuthProvider.credential(googleTokens.idToken);
  const userCredential = await signInWithCredential(firebase.auth, credential);

  const email = userCredential.user.email;
  if (email == null) {
    throw new Error("No email address associated with Google account.");
  }

  return {
    refreshToken: userCredential.user.refreshToken,
    idToken: await userCredential.user.getIdToken(),
    email,
  };
};

/**
 * Main login function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.email - Email address (for non-interactive mode)
 * @param args.password - Password (for non-interactive mode)
 * @param args.google - Whether to use Google SSO
 */
export const loginMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  email?: string | null;
  password?: string | null;
  google?: boolean | null;
}): Promise<void> => {
  const {
    installDir,
    nonInteractive,
    email,
    password,
    google: useGoogle,
  } = args ?? {};
  // Default to ~/.nori for config storage
  const configDir = installDir ?? DEFAULT_CONFIG_DIR;

  // Validate flag combinations
  if (useGoogle && (email != null || password != null)) {
    error({
      message:
        "Cannot use --google with --email or --password. Google SSO handles authentication via the browser.",
    });
    return;
  }

  if (useGoogle && nonInteractive) {
    error({
      message:
        "Cannot use --google with --non-interactive. Google SSO requires a browser for authentication.",
    });
    return;
  }

  let refreshToken: string;
  let idToken: string;
  let userEmail: string;

  if (useGoogle) {
    // Google SSO flow
    try {
      const result = await authenticateWithGoogle();
      refreshToken = result.refreshToken;
      idToken = result.idToken;
      userEmail = result.email;
    } catch (err) {
      const authError = err as AuthError;
      error({ message: "Authentication failed" });
      error({ message: `  Error: ${authError.message}` });

      if ((authError as AuthError).code === "auth/operation-not-allowed") {
        error({
          message:
            "  Hint: Google sign-in may not be enabled for this project. Contact your administrator.",
        });
      }

      return;
    }
  } else {
    // Email/password flow
    let inputEmail: string;
    let inputPassword: string;

    if (nonInteractive) {
      if (email == null || password == null) {
        error({
          message:
            "Non-interactive mode requires --email and --password flags.",
        });
        return;
      }
      inputEmail = email;
      inputPassword = password;
    } else {
      inputEmail = await promptUser({ prompt: "Email: " });
      if (!inputEmail || inputEmail.trim() === "") {
        error({ message: "Email is required." });
        return;
      }

      inputPassword = await promptUser({ prompt: "Password: ", hidden: true });
      if (!inputPassword) {
        error({ message: "Password is required." });
        return;
      }
    }

    info({ message: "Authenticating..." });

    try {
      configureFirebase();
      const firebase = getFirebase();

      const userCredential = await signInWithEmailAndPassword(
        firebase.auth,
        inputEmail,
        inputPassword,
      );

      refreshToken = userCredential.user.refreshToken;
      idToken = await userCredential.user.getIdToken();
      userEmail = inputEmail;
    } catch (err) {
      const authError = err as AuthError;
      error({ message: "Authentication failed" });
      error({ message: `  Error: ${authError.message}` });

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

      return;
    }
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
    info({
      message: "No private organizations found. Using public registry.",
    });
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
    .option("-g, --google", "Sign in with Google SSO")
    .action(
      async (options: {
        email?: string;
        password?: string;
        google?: boolean;
      }) => {
        const globalOpts = program.opts();

        await loginMain({
          installDir: globalOpts.installDir || null,
          nonInteractive: globalOpts.nonInteractive || null,
          email: options.email || null,
          password: options.password || null,
          google: options.google || null,
        });
      },
    );
};
