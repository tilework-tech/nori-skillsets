/**
 * Login Command
 *
 * Authenticates users against noriskillsets.dev and stores credentials.
 * Supports email/password and Google SSO authentication.
 */

import * as os from "os";

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
import { formatNetworkError } from "@/utils/fetch.js";

import type { Command } from "commander";
import type { AuthError } from "firebase/auth";

import {
  AUTH_WARNING_MS,
  exchangeCodeForTokens,
  findAvailablePort,
  generateState,
  getGoogleAuthUrl,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  isHeadlessEnvironment,
  startAuthServer,
  validateOAuthCredentials,
} from "./googleAuth.js";

/** Redirect URI for headless/no-localhost mode */
const HEADLESS_REDIRECT_URI = "https://noriskillsets.dev/oauth/callback";

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
  } catch (err) {
    // Log network errors for debugging but don't fail the login
    if (err instanceof Error) {
      const networkError = formatNetworkError({
        error: err,
        url: `${NORI_SKILLSETS_API_URL}/api/auth/check-access`,
      });
      console.error(`Network error checking access: ${networkError.message}`);
    }
    return null;
  }
};

/** Default config directory for login/logout commands */
const DEFAULT_CONFIG_DIR = os.homedir();

/**
 * Authenticate via Google SSO using the localhost OAuth callback pattern,
 * or via manual code entry when --no-localhost is set.
 *
 * @param args - Configuration arguments
 * @param args.noLocalhost - If true, use hosted callback page instead of localhost
 *
 * @returns Firebase credentials (refreshToken, idToken, email)
 */
const authenticateWithGoogle = async (args?: {
  noLocalhost?: boolean | null;
}): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
}> => {
  const { noLocalhost } = args ?? {};

  // Fail fast if OAuth credentials are not configured
  validateOAuthCredentials();

  // Generate CSRF protection nonce
  const state = generateState();

  let redirectUri: string;
  let code: string;

  if (noLocalhost) {
    // Headless mode: use noriskillsets.dev callback page
    redirectUri = HEADLESS_REDIRECT_URI;

    // Build the Google OAuth URL
    const authUrl = getGoogleAuthUrl({
      clientId: GOOGLE_OAUTH_CLIENT_ID,
      redirectUri,
      state,
    });

    // Display instructions
    newline();
    info({ message: "Authentication URL:" });
    info({ message: `  ${authUrl}` });
    newline();
    info({ message: "Instructions:" });
    info({ message: "  1. Open the URL above in any browser" });
    info({ message: "  2. Complete the Google sign-in" });
    info({ message: "  3. Copy the authorization code from the page" });
    info({ message: "  4. Paste it below" });
    newline();

    // Prompt user to paste the code
    const inputCode = await promptUser({
      prompt: "Paste authorization code: ",
    });

    if (inputCode == null || inputCode.trim() === "") {
      throw new Error("No authorization code provided.");
    }

    code = inputCode.trim();
  } else {
    // Standard mode: use localhost callback server
    const port = await findAvailablePort({});
    redirectUri = `http://localhost:${port}`;

    // Build the Google OAuth URL
    const authUrl = getGoogleAuthUrl({
      clientId: GOOGLE_OAUTH_CLIENT_ID,
      redirectUri,
      state,
    });

    // Always display the auth URL for headless/SSH environments
    newline();
    info({ message: "Authentication URL:" });
    info({ message: `  ${authUrl}` });
    newline();

    // Detect SSH environment and provide port forwarding instructions
    if (isHeadlessEnvironment()) {
      info({ message: "Detected SSH/headless environment." });
      info({ message: "To authenticate from a remote session:" });
      info({ message: `  1. Run this on your local machine:` });
      info({
        message: `     ssh -L ${port}:localhost:${port} <user>@<server>`,
      });
      info({ message: `  2. Open the URL above in your local browser` });
      newline();
    }

    // Start the local server to capture the callback
    const serverPromise = startAuthServer({
      port,
      expectedState: state,
      warningMs: AUTH_WARNING_MS,
      onTimeoutWarning: () => {
        warn({
          message:
            "Authentication will timeout in 1 minute. Please complete the browser flow.",
        });
      },
    });

    // Attempt to open browser (may fail silently in headless)
    info({ message: "Attempting to open browser..." });
    try {
      await open(authUrl);
    } catch {
      // Browser failed to open - already displayed the URL above
    }

    // Wait for the OAuth callback
    const result = await serverPromise;
    code = result.code;
    result.server.close();
  }

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
 * @param args.noLocalhost - Whether to use hosted callback page instead of localhost
 */
export const loginMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  email?: string | null;
  password?: string | null;
  google?: boolean | null;
  noLocalhost?: boolean | null;
}): Promise<void> => {
  const {
    installDir,
    nonInteractive,
    email,
    password,
    google: useGoogle,
    noLocalhost,
  } = args ?? {};
  // Default to home directory for config storage
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

  if (noLocalhost && !useGoogle) {
    error({
      message:
        "Cannot use --no-localhost without --google. This flag is only for Google SSO.",
    });
    return;
  }

  let refreshToken: string;
  let idToken: string;
  let userEmail: string;

  if (useGoogle) {
    // Google SSO flow
    try {
      const result = await authenticateWithGoogle({ noLocalhost });
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
    .option(
      "--no-localhost",
      "Use hosted callback page instead of localhost (for headless/SSH)",
    )
    .action(
      async (options: {
        email?: string;
        password?: string;
        google?: boolean;
        localhost?: boolean;
      }) => {
        const globalOpts = program.opts();

        await loginMain({
          installDir: globalOpts.installDir || null,
          nonInteractive: globalOpts.nonInteractive || null,
          email: options.email || null,
          password: options.password || null,
          google: options.google || null,
          noLocalhost: options.localhost === false ? true : null,
        });
      },
    );
};
