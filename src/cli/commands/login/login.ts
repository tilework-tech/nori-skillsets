/**
 * Login Command
 *
 * Authenticates users against noriskillsets.dev and stores credentials.
 * Supports email/password and Google SSO authentication.
 */

import { select, isCancel, cancel, note, log, spinner } from "@clack/prompts";
import {
  signInWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  AuthErrorCodes,
} from "firebase/auth";
import open from "open";

import { loadConfig, updateConfig } from "@/cli/config.js";
import {
  loginFlow,
  confirmAction,
  promptPassword,
  type AuthenticateResult,
} from "@/cli/prompts/index.js";
import { configureFirebase, getFirebase } from "@/providers/firebase.js";
import { formatNetworkError } from "@/utils/fetch.js";
import { buildOrganizationRegistryUrl, isValidOrgId } from "@/utils/url.js";

/** API token format: `nori_` + 64 hex chars (matches server PR #329). */
const API_TOKEN_PATTERN = /^nori_[a-f0-9]{64}$/;

import type { CommandStatus } from "@/cli/commands/commandStatus.js";
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
  GOOGLE_OAUTH_WEB_CLIENT_ID,
  isHeadlessEnvironment,
  startAuthServer,
  validateOAuthCredentials,
  validateWebOAuthCredentials,
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
      log.error(`Network error checking access: ${networkError.message}`);
    }
    return null;
  }
};

/**
 * Authenticate via Google SSO using the headless flow with manual token entry.
 * The server exchanges the code for tokens, and the user pastes the id_token.
 *
 * @returns Firebase credentials (refreshToken, idToken, email)
 */
const authenticateWithGoogleHeadless = async (): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
}> => {
  // Headless mode: use Web Application client, server handles token exchange
  validateWebOAuthCredentials();

  // Generate CSRF protection nonce (for display purposes)
  const state = generateState();

  // Build the Google OAuth URL with Web Application client ID
  const authUrl = getGoogleAuthUrl({
    clientId: GOOGLE_OAUTH_WEB_CLIENT_ID,
    redirectUri: HEADLESS_REDIRECT_URI,
    state,
  });

  // Display instructions
  log.step(authUrl);
  note(
    [
      "1. Open the URL above in any browser",
      "2. Complete the Google sign-in",
      "3. Copy the token from the page",
      "4. Paste it below",
    ].join("\n"),
    "Instructions",
  );

  // Prompt user to paste the id_token (server already exchanged the code)
  // Use masked input to hide the sensitive token
  const inputToken = await promptPassword({ message: "Paste token" });

  if (inputToken == null || inputToken.trim() === "") {
    throw new Error("No token provided.");
  }

  // Use the id_token directly with Firebase (no exchange needed)
  const s = spinner();
  s.start("Signing in...");

  configureFirebase();
  const firebase = getFirebase();
  const credential = GoogleAuthProvider.credential(inputToken.trim());
  const userCredential = await signInWithCredential(firebase.auth, credential);

  const email = userCredential.user.email;
  if (email == null) {
    s.stop("Sign in failed");
    throw new Error("No email address associated with Google account.");
  }

  s.stop("Signed in");
  return {
    refreshToken: userCredential.user.refreshToken,
    idToken: await userCredential.user.getIdToken(),
    email,
  };
};

/**
 * Authenticate via Google SSO using the localhost OAuth callback pattern.
 *
 * @param args - Configuration arguments
 * @param args.showPortForwardingInstructions - If true, show SSH port forwarding instructions
 *
 * @returns Firebase credentials (refreshToken, idToken, email)
 */
const authenticateWithGoogleLocalhost = async (args?: {
  showPortForwardingInstructions?: boolean | null;
}): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
}> => {
  const { showPortForwardingInstructions } = args ?? {};

  // Standard mode: use Desktop client with localhost callback server
  validateOAuthCredentials();

  // Generate CSRF protection nonce
  const state = generateState();

  const port = await findAvailablePort({});
  const redirectUri = `http://localhost:${port}`;

  // Build the Google OAuth URL
  const authUrl = getGoogleAuthUrl({
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    redirectUri,
    state,
  });

  // Always display the auth URL
  log.step(authUrl);

  // Show port forwarding instructions if requested (user is in headless but chose localhost flow)
  if (showPortForwardingInstructions) {
    note(
      [
        "1. Run this on your local machine:",
        `   ssh -L ${port}:localhost:${port} <user>@<server>`,
        "2. Open the URL above in your local browser",
      ].join("\n"),
      "SSH Port Forwarding",
    );
  }

  // Start the local server to capture the callback
  const serverPromise = startAuthServer({
    port,
    expectedState: state,
    warningMs: AUTH_WARNING_MS,
    onTimeoutWarning: () => {
      log.warn(
        "Authentication will timeout in 1 minute. Please complete the browser flow.",
      );
    },
  });

  // Attempt to open browser (may fail silently in headless)
  log.info("Attempting to open browser...");
  try {
    await open(authUrl);
  } catch {
    // Browser failed to open - already displayed the URL above
  }

  // Wait for the OAuth callback
  const result = await serverPromise;
  const code = result.code;
  result.server.close();

  // Exchange the authorization code for Google tokens
  const s = spinner();
  s.start("Exchanging authorization code...");

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
    s.stop("Sign in failed");
    throw new Error("No email address associated with Google account.");
  }

  s.stop("Signed in");
  return {
    refreshToken: userCredential.user.refreshToken,
    idToken: await userCredential.user.getIdToken(),
    email,
  };
};

/**
 * Authenticate via Google SSO. Automatically detects headless environments
 * and prompts the user to choose between headless flow or localhost flow.
 *
 * @param args - Configuration arguments
 * @param args.noLocalhost - If true, force use of headless flow (skips environment detection)
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

  // If --no-localhost flag is explicitly set, use headless flow directly
  if (noLocalhost) {
    return authenticateWithGoogleHeadless();
  }

  // Detect headless/SSH environment
  if (isHeadlessEnvironment()) {
    log.warn(
      "Detected SSH/headless environment. You can use a simplified headless flow that works without port forwarding.",
    );

    const useHeadlessFlow = await confirmAction({
      message: "Use headless authentication flow?",
      initialValue: true,
    });

    if (useHeadlessFlow) {
      return authenticateWithGoogleHeadless();
    } else {
      // User chose localhost flow in headless environment - show port forwarding instructions
      return authenticateWithGoogleLocalhost({
        showPortForwardingInstructions: true,
      });
    }
  }

  // Standard local environment - use localhost flow without port forwarding instructions
  return authenticateWithGoogleLocalhost();
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
 * @param args.token - Raw API token (nori_<64hex>) for non-interactive private-org auth
 * @param args.org - Org id the API token is scoped to (required with --token)
 *
 * @returns Command status
 */
export const loginMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  email?: string | null;
  password?: string | null;
  google?: boolean | null;
  noLocalhost?: boolean | null;
  token?: string | null;
  org?: string | null;
}): Promise<CommandStatus> => {
  const {
    nonInteractive,
    email,
    password,
    google: useGoogle,
    noLocalhost,
    token,
    org,
  } = args ?? {};

  // API-token login path — short-circuits all Firebase flows.
  if (token != null) {
    if (email != null || password != null || useGoogle) {
      return {
        success: false,
        cancelled: false,
        message:
          "Cannot combine --token with --email, --password, or --google. API-token auth is mutually exclusive with Firebase auth.",
      };
    }
    if (org == null) {
      return {
        success: false,
        cancelled: false,
        message: "--token requires --org <orgId>.",
      };
    }
    if (!API_TOKEN_PATTERN.test(token)) {
      return {
        success: false,
        cancelled: false,
        message:
          "Invalid --token value. Expected format: nori_ followed by 64 hexadecimal characters.",
      };
    }
    if (org === "public") {
      return {
        success: false,
        cancelled: false,
        message:
          "API tokens are not supported on the public registry (--org public). Use a private org id.",
      };
    }
    if (!isValidOrgId({ orgId: org })) {
      return {
        success: false,
        cancelled: false,
        message: `Invalid --org value: '${org}'. Org IDs must be lowercase alphanumeric with hyphens.`,
      };
    }

    const organizationUrl = buildOrganizationRegistryUrl({ orgId: org });

    // Detect whether an existing Firebase session is about to be overwritten,
    // so we can tell the user explicitly (per spec edge case 8).
    const existing = await loadConfig();
    const hadFirebaseSession =
      existing?.auth != null &&
      (existing.auth.refreshToken != null || existing.auth.password != null);

    await updateConfig({
      auth: {
        username: null,
        organizationUrl,
        apiToken: token,
        apiTokenOrgId: org,
        refreshToken: null,
        password: null,
        organizations: [org],
        isAdmin: null,
      },
    });

    if (hadFirebaseSession) {
      log.warn(
        "Existing Firebase session (refreshToken/password/username) has been cleared. Use 'nori-skillsets login' without --token to sign back in with Firebase.",
      );
    }

    return {
      success: true,
      cancelled: false,
      message: `Logged in with API token for org '${org}'.`,
    };
  }

  // Validate flag combinations
  if (useGoogle && (email != null || password != null)) {
    return {
      success: false,
      cancelled: false,
      message:
        "Cannot use --google with --email or --password. Google SSO handles authentication via the browser",
    };
  }

  if (useGoogle && nonInteractive) {
    return {
      success: false,
      cancelled: false,
      message:
        "Cannot use --google with --non-interactive. Google SSO requires a browser for authentication",
    };
  }

  if (noLocalhost && !useGoogle) {
    return {
      success: false,
      cancelled: false,
      message:
        "Cannot use --no-localhost without --google. This flag is only for Google SSO",
    };
  }

  let refreshToken: string;
  let idToken: string;
  let userEmail: string;

  if (useGoogle) {
    // Google SSO flow (explicit --google flag)
    try {
      const result = await authenticateWithGoogle({
        noLocalhost,
      });
      refreshToken = result.refreshToken;
      idToken = result.idToken;
      userEmail = result.email;
    } catch (err) {
      const authError = err as AuthError;
      log.error("Authentication failed");
      log.error(`  Error: ${authError.message}`);

      if ((authError as AuthError).code === "auth/operation-not-allowed") {
        log.error(
          "  Hint: Google sign-in may not be enabled for this project. Contact your administrator.",
        );
      }

      return {
        success: false,
        cancelled: false,
        message: `Authentication failed: ${authError.message}`,
      };
    }
  } else if (nonInteractive) {
    // Non-interactive email/password flow: use provided credentials directly
    if (email == null || password == null) {
      return {
        success: false,
        cancelled: false,
        message: "Non-interactive mode requires --email and --password flags",
      };
    }

    log.info("Authenticating...");

    try {
      configureFirebase();
      const firebase = getFirebase();

      const userCredential = await signInWithEmailAndPassword(
        firebase.auth,
        email,
        password,
      );

      refreshToken = userCredential.user.refreshToken;
      idToken = await userCredential.user.getIdToken();
      userEmail = email;
    } catch (err) {
      const authError = err as AuthError;
      log.error("Authentication failed");
      log.error(`  Error: ${authError.message}`);
      return {
        success: false,
        cancelled: false,
        message: `Authentication failed: ${authError.message}`,
      };
    }
  } else {
    // Interactive mode: show auth method selection

    const authMethod = await select({
      message: "Authentication method",
      options: [
        { value: "email", label: "Email / Password" },
        { value: "google", label: "Google SSO" },
      ],
    });

    if (isCancel(authMethod)) {
      cancel("Login cancelled.");
      return { success: false, cancelled: true, message: "" };
    }

    if (authMethod === "email") {
      // Email/password flow via loginFlow
      const result = await loginFlow({
        callbacks: {
          onAuthenticate: async (args): Promise<AuthenticateResult> => {
            const { email: inputEmail, password: inputPassword } = args;

            try {
              configureFirebase();
              const firebase = getFirebase();

              const userCredential = await signInWithEmailAndPassword(
                firebase.auth,
                inputEmail,
                inputPassword,
              );

              const token = await userCredential.user.getIdToken();

              // Fetch user's organizations and admin status
              const accessInfo = await fetchUserAccess({ idToken: token });

              return {
                success: true,
                userEmail: inputEmail,
                organizations: accessInfo?.organizations ?? [],
                isAdmin: accessInfo?.isAdmin ?? false,
                refreshToken: userCredential.user.refreshToken,
                idToken: token,
              };
            } catch (err) {
              const authError = err as AuthError;
              let hint: string | null = null;

              if (
                authError.code === AuthErrorCodes.INVALID_PASSWORD ||
                authError.code === AuthErrorCodes.INVALID_LOGIN_CREDENTIALS ||
                authError.code === "auth/invalid-credential"
              ) {
                hint = "Check that your email and password are correct.";
              } else if (authError.code === AuthErrorCodes.USER_DELETED) {
                hint = "This email is not registered. Contact support.";
              } else if (
                authError.code === AuthErrorCodes.TOO_MANY_ATTEMPTS_TRY_LATER
              ) {
                hint =
                  "Too many failed attempts. Wait a few minutes and try again.";
              } else if (
                authError.code === AuthErrorCodes.NETWORK_REQUEST_FAILED
              ) {
                hint = "Network error. Check your internet connection.";
              }

              return {
                success: false,
                error: authError.message,
                hint,
              };
            }
          },
        },
      });

      if (result == null) {
        // User cancelled or auth failed (flow handles the UI)
        return { success: false, cancelled: true, message: "" };
      }

      // Use the tokens from the flow result (no need to re-authenticate)
      refreshToken = result.refreshToken;
      idToken = result.idToken;
      userEmail = result.email;

      // Save credentials to config (using access info from flow result)
      await updateConfig({
        auth: {
          username: userEmail,
          refreshToken,
          organizationUrl: NORI_SKILLSETS_API_URL,
          organizations: result.organizations,
          isAdmin: result.isAdmin,
        },
      });

      return {
        success: true,
        cancelled: false,
        message: `Logged in as ${userEmail}`,
      };
    } else {
      // Google SSO flow selected from interactive UI
      try {
        const result = await authenticateWithGoogle({
          noLocalhost,
        });
        refreshToken = result.refreshToken;
        idToken = result.idToken;
        userEmail = result.email;
      } catch (err) {
        const authError = err as AuthError;
        log.error("Authentication failed");
        log.error(`  Error: ${authError.message}`);

        if ((authError as AuthError).code === "auth/operation-not-allowed") {
          log.error(
            "  Hint: Google sign-in may not be enabled for this project. Contact your administrator.",
          );
        }

        return {
          success: false,
          cancelled: false,
          message: `Authentication failed: ${authError.message}`,
        };
      }
    }
  }

  // For Google SSO and non-interactive flows, fetch and display access info
  let organizations: Array<string> = [];
  let isAdmin = false;

  const accessInfo = await fetchUserAccess({ idToken });

  if (accessInfo == null) {
    log.warn(
      "Could not fetch organization information. Saving credentials without organization data.",
    );
  } else {
    organizations = accessInfo.organizations;
    isAdmin = accessInfo.isAdmin;
  }

  // Save credentials to config
  await updateConfig({
    auth: {
      username: userEmail,
      refreshToken,
      organizationUrl: NORI_SKILLSETS_API_URL,
      organizations,
      isAdmin,
    },
  });

  if (organizations.length > 0) {
    const lines = [`Organizations: ${organizations.join(", ")}`];
    if (isAdmin) {
      lines.push("Admin: Yes");
    }
    note(lines.join("\n"), "Account Info");
  } else {
    note(
      "No private organizations found. Using public registry.",
      "Account Info",
    );
  }
  return {
    success: true,
    cancelled: false,
    message: `Logged in as ${userEmail}`,
  };
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
    .option(
      "--token <token>",
      "API token (nori_<64hex>) for non-interactive private-org auth",
    )
    .option(
      "--org <orgId>",
      "Organization ID the API token is scoped to (required with --token)",
    )
    .action(
      async (options: {
        email?: string;
        password?: string;
        google?: boolean;
        localhost?: boolean;
        token?: string;
        org?: string;
      }) => {
        const globalOpts = program.opts();

        await loginMain({
          installDir: globalOpts.installDir || null,
          nonInteractive: globalOpts.nonInteractive || null,
          email: options.email || null,
          password: options.password || null,
          google: options.google || null,
          noLocalhost: options.localhost === false ? true : null,
          token: options.token || null,
          org: options.org || null,
        });
      },
    );
};
