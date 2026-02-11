/**
 * Login Command
 *
 * Authenticates users against noriskillsets.dev and stores credentials.
 * Supports email/password and Google SSO authentication.
 */

import * as os from "os";

import {
  select,
  isCancel,
  cancel,
  intro,
  outro,
  note,
  log,
  spinner,
} from "@clack/prompts";
import {
  signInWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  AuthErrorCodes,
} from "firebase/auth";
import open from "open";

import { loadConfig, saveConfig } from "@/cli/config.js";
import { error, info, success, warn, newline } from "@/cli/logger.js";
import { promptUser, promptYesNo } from "@/cli/prompt.js";
import {
  loginFlow,
  confirmAction,
  promptPassword,
  type AuthenticateResult,
} from "@/cli/prompts/index.js";
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
      console.error(`Network error checking access: ${networkError.message}`);
    }
    return null;
  }
};

/** Default config directory for login/logout commands */
const DEFAULT_CONFIG_DIR = os.homedir();

/**
 * Authenticate via Google SSO using the headless flow with manual token entry.
 * The server exchanges the code for tokens, and the user pastes the id_token.
 *
 * @param args - Configuration arguments
 * @param args.experimentalUi - Whether to use clack prompts instead of legacy output
 *
 * @returns Firebase credentials (refreshToken, idToken, email)
 */
const authenticateWithGoogleHeadless = async (args?: {
  experimentalUi?: boolean | null;
}): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
}> => {
  const { experimentalUi } = args ?? {};

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
  if (experimentalUi) {
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
  } else {
    newline();
    info({ message: "Authentication URL:" });
    info({ message: `  ${authUrl}` });
    newline();
    info({ message: "Instructions:" });
    info({ message: "  1. Open the URL above in any browser" });
    info({ message: "  2. Complete the Google sign-in" });
    info({ message: "  3. Copy the token from the page" });
    info({ message: "  4. Paste it below" });
    newline();
  }

  // Prompt user to paste the id_token (server already exchanged the code)
  // Use masked input to hide the sensitive token
  let inputToken: string;
  if (experimentalUi) {
    inputToken = await promptPassword({ message: "Paste token" });
  } else {
    inputToken = await promptUser({
      prompt: "Paste token: ",
      masked: true,
    });
  }

  if (inputToken == null || inputToken.trim() === "") {
    throw new Error("No token provided.");
  }

  // Use the id_token directly with Firebase (no exchange needed)
  const s = experimentalUi ? spinner() : null;
  if (s != null) {
    s.start("Signing in...");
  } else {
    info({ message: "Signing in..." });
  }

  configureFirebase();
  const firebase = getFirebase();
  const credential = GoogleAuthProvider.credential(inputToken.trim());
  const userCredential = await signInWithCredential(firebase.auth, credential);

  const email = userCredential.user.email;
  if (email == null) {
    if (s != null) {
      s.stop("Sign in failed");
    }
    throw new Error("No email address associated with Google account.");
  }

  if (s != null) {
    s.stop("Signed in");
  }
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
 * @param args.experimentalUi - Whether to use clack prompts instead of legacy output
 *
 * @returns Firebase credentials (refreshToken, idToken, email)
 */
const authenticateWithGoogleLocalhost = async (args?: {
  showPortForwardingInstructions?: boolean | null;
  experimentalUi?: boolean | null;
}): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
}> => {
  const { showPortForwardingInstructions, experimentalUi } = args ?? {};

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
  if (experimentalUi) {
    log.step(authUrl);
  } else {
    newline();
    info({ message: "Authentication URL:" });
    info({ message: `  ${authUrl}` });
    newline();
  }

  // Show port forwarding instructions if requested (user is in headless but chose localhost flow)
  if (showPortForwardingInstructions) {
    if (experimentalUi) {
      note(
        [
          "1. Run this on your local machine:",
          `   ssh -L ${port}:localhost:${port} <user>@<server>`,
          "2. Open the URL above in your local browser",
        ].join("\n"),
        "SSH Port Forwarding",
      );
    } else {
      info({ message: "To authenticate from this remote session:" });
      info({ message: `  1. Run this on your local machine:` });
      info({
        message: `     ssh -L ${port}:localhost:${port} <user>@<server>`,
      });
      info({ message: `  2. Open the URL above in your local browser` });
      newline();
    }
  }

  // Start the local server to capture the callback
  const serverPromise = startAuthServer({
    port,
    expectedState: state,
    warningMs: AUTH_WARNING_MS,
    onTimeoutWarning: () => {
      if (experimentalUi) {
        log.warn(
          "Authentication will timeout in 1 minute. Please complete the browser flow.",
        );
      } else {
        warn({
          message:
            "Authentication will timeout in 1 minute. Please complete the browser flow.",
        });
      }
    },
  });

  // Attempt to open browser (may fail silently in headless)
  if (experimentalUi) {
    log.info("Attempting to open browser...");
  } else {
    info({ message: "Attempting to open browser..." });
  }
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
  const s = experimentalUi ? spinner() : null;
  if (s != null) {
    s.start("Exchanging authorization code...");
  } else {
    info({ message: "Exchanging authorization code..." });
  }

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
    if (s != null) {
      s.stop("Sign in failed");
    }
    throw new Error("No email address associated with Google account.");
  }

  if (s != null) {
    s.stop("Signed in");
  }
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
 * @param args.confirmHeadless - Optional function to confirm headless flow (replaces legacy promptYesNo)
 * @param args.experimentalUi - Whether to use clack prompts instead of legacy output
 *
 * @returns Firebase credentials (refreshToken, idToken, email)
 */
const authenticateWithGoogle = async (args?: {
  noLocalhost?: boolean | null;
  confirmHeadless?: ((args: { message: string }) => Promise<boolean>) | null;
  experimentalUi?: boolean | null;
}): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
}> => {
  const { noLocalhost, confirmHeadless, experimentalUi } = args ?? {};

  // If --no-localhost flag is explicitly set, use headless flow directly
  if (noLocalhost) {
    return authenticateWithGoogleHeadless({ experimentalUi });
  }

  // Detect headless/SSH environment
  if (isHeadlessEnvironment()) {
    if (experimentalUi) {
      log.warn(
        "Detected SSH/headless environment. You can use a simplified headless flow that works without port forwarding.",
      );
    } else {
      newline();
      info({ message: "Detected SSH/headless environment." });
      info({
        message:
          "You can use a simplified headless flow that works without port forwarding.",
      });
      newline();
    }

    let useHeadlessFlow: boolean;

    if (confirmHeadless != null) {
      useHeadlessFlow = await confirmHeadless({
        message: "Use headless authentication flow?",
      });
    } else {
      useHeadlessFlow = await promptYesNo({
        prompt: "Use headless authentication flow?",
        defaultValue: true,
      });
    }

    if (useHeadlessFlow) {
      return authenticateWithGoogleHeadless({ experimentalUi });
    } else {
      // User chose localhost flow in headless environment - show port forwarding instructions
      return authenticateWithGoogleLocalhost({
        showPortForwardingInstructions: true,
        experimentalUi,
      });
    }
  }

  // Standard local environment - use localhost flow without port forwarding instructions
  return authenticateWithGoogleLocalhost({ experimentalUi });
};

/**
 * Authenticate with email/password using legacy prompts (basic readline).
 * Used when --experimental-ui is not enabled.
 *
 * @param args - Configuration arguments
 * @param args.configDir - Directory to save config to
 *
 * @returns Authentication result with tokens and user info, or null if cancelled/failed
 */
const authenticateWithLegacyPrompts = async (args: {
  configDir: string;
}): Promise<{
  refreshToken: string;
  idToken: string;
  email: string;
  organizations: Array<string>;
  isAdmin: boolean;
} | null> => {
  const { configDir } = args;

  // Prompt for email
  const inputEmail = await promptUser({
    prompt: "Email: ",
  });

  if (inputEmail == null || inputEmail.trim() === "") {
    error({ message: "Email is required." });
    return null;
  }

  // Prompt for password (masked)
  const inputPassword = await promptUser({
    prompt: "Password: ",
    masked: true,
  });

  if (inputPassword == null || inputPassword.trim() === "") {
    error({ message: "Password is required." });
    return null;
  }

  info({ message: "Authenticating..." });

  try {
    configureFirebase();
    const firebase = getFirebase();

    const userCredential = await signInWithEmailAndPassword(
      firebase.auth,
      inputEmail.trim(),
      inputPassword,
    );

    const idToken = await userCredential.user.getIdToken();

    // Fetch user's organizations and admin status
    const accessInfo = await fetchUserAccess({ idToken });

    const organizations = accessInfo?.organizations ?? [];
    const isAdmin = accessInfo?.isAdmin ?? false;

    // Load existing config to preserve other fields
    const existingConfig = await loadConfig();

    // Save credentials to config
    await saveConfig({
      username: inputEmail.trim(),
      refreshToken: userCredential.user.refreshToken,
      organizationUrl: NORI_SKILLSETS_API_URL,
      organizations,
      isAdmin,
      sendSessionTranscript: existingConfig?.sendSessionTranscript ?? null,
      autoupdate: existingConfig?.autoupdate ?? null,
      agents: existingConfig?.agents ?? null,
      version: existingConfig?.version ?? null,
      transcriptDestination: existingConfig?.transcriptDestination ?? null,
      installDir: configDir,
    });

    newline();
    success({ message: `Logged in as ${inputEmail.trim()}` });

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

    return {
      refreshToken: userCredential.user.refreshToken,
      idToken,
      email: inputEmail.trim(),
      organizations,
      isAdmin,
    };
  } catch (err) {
    const authError = err as AuthError;
    error({ message: "Authentication failed" });
    error({ message: `  Error: ${authError.message}` });

    // Provide helpful hints for common errors
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

    return null;
  }
};

/**
 * Main login function
 *
 * @param args - Configuration arguments
 * @param args.installDir - Installation directory
 * @param args.nonInteractive - Whether to run in non-interactive mode
 * @param args.experimentalUi - Whether to use new interactive TUI flows
 * @param args.email - Email address (for non-interactive mode)
 * @param args.password - Password (for non-interactive mode)
 * @param args.google - Whether to use Google SSO
 * @param args.noLocalhost - Whether to use hosted callback page instead of localhost
 */
export const loginMain = async (args?: {
  installDir?: string | null;
  nonInteractive?: boolean | null;
  experimentalUi?: boolean | null;
  email?: string | null;
  password?: string | null;
  google?: boolean | null;
  noLocalhost?: boolean | null;
}): Promise<void> => {
  const {
    installDir,
    nonInteractive,
    experimentalUi,
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

  if (noLocalhost && !useGoogle && !experimentalUi) {
    error({
      message:
        "Cannot use --no-localhost without --google. This flag is only for Google SSO.",
    });
    return;
  }

  const clackConfirmHeadless = async (args: {
    message: string;
  }): Promise<boolean> => {
    return confirmAction({
      message: args.message,
      initialValue: true,
    });
  };

  let refreshToken: string;
  let idToken: string;
  let userEmail: string;

  if (useGoogle) {
    // Google SSO flow (explicit --google flag)
    try {
      const result = await authenticateWithGoogle({
        noLocalhost,
        confirmHeadless: experimentalUi ? clackConfirmHeadless : null,
        experimentalUi,
      });
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
  } else if (nonInteractive) {
    // Non-interactive email/password flow: use provided credentials directly
    if (email == null || password == null) {
      error({
        message: "Non-interactive mode requires --email and --password flags.",
      });
      return;
    }

    info({ message: "Authenticating..." });

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
      error({ message: "Authentication failed" });
      error({ message: `  Error: ${authError.message}` });
      return;
    }
  } else if (experimentalUi) {
    // Interactive mode with experimental UI: show auth method selection
    intro("Login to Nori Skillsets");

    const authMethod = await select({
      message: "Authentication method",
      options: [
        { value: "email", label: "Email / Password" },
        { value: "google", label: "Google SSO" },
      ],
    });

    if (isCancel(authMethod)) {
      cancel("Login cancelled.");
      return;
    }

    if (authMethod === "email") {
      // Email/password flow via loginFlow (skip intro since we already showed it)
      const result = await loginFlow({
        skipIntro: true,
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
        return;
      }

      // Use the tokens from the flow result (no need to re-authenticate)
      refreshToken = result.refreshToken;
      idToken = result.idToken;
      userEmail = result.email;

      // Load existing config to preserve other fields
      const existingConfig = await loadConfig();

      // Save credentials to config (using access info from flow result)
      await saveConfig({
        username: userEmail,
        refreshToken,
        organizationUrl: NORI_SKILLSETS_API_URL,
        organizations: result.organizations,
        isAdmin: result.isAdmin,
        sendSessionTranscript: existingConfig?.sendSessionTranscript ?? null,
        autoupdate: existingConfig?.autoupdate ?? null,
        agents: existingConfig?.agents ?? null,
        version: existingConfig?.version ?? null,
        transcriptDestination: existingConfig?.transcriptDestination ?? null,
        installDir: configDir,
      });

      // Flow already showed outro, so we're done
      return;
    } else {
      // Google SSO flow selected from experimental UI
      try {
        const result = await authenticateWithGoogle({
          noLocalhost,
          confirmHeadless: clackConfirmHeadless,
          experimentalUi,
        });
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
    }
  } else {
    // Interactive mode with legacy prompts (default)
    const result = await authenticateWithLegacyPrompts({ configDir });
    if (result == null) {
      // User cancelled or auth failed
      return;
    }

    // Legacy flow already saved config and showed success message
    return;
  }

  // For Google SSO and non-interactive flows, fetch and display access info
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
  const existingConfig = await loadConfig();

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
    transcriptDestination: existingConfig?.transcriptDestination ?? null,
    installDir: configDir,
  });

  if (experimentalUi) {
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
    // Use clack outro to balance the intro shown earlier
    outro(`Logged in as ${userEmail}`);
  } else {
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
          experimentalUi: globalOpts.experimentalUi || null,
          email: options.email || null,
          password: options.password || null,
          google: options.google || null,
          noLocalhost: options.localhost === false ? true : null,
        });
      },
    );
};
