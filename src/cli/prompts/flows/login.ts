/**
 * Login flow module
 *
 * Provides the complete interactive login experience using @clack/prompts.
 * This flow handles:
 * - Intro message
 * - Grouped email/password collection
 * - Spinner during authentication
 * - Note display for organization info
 * - Outro message on success
 */

import {
  intro,
  outro,
  group,
  text,
  password,
  spinner,
  note,
  log,
  isCancel,
  cancel,
} from "@clack/prompts";

/**
 * Result of successful authentication callback
 */
export type AuthenticateResult =
  | {
      success: true;
      userEmail: string;
      organizations: Array<string>;
      isAdmin: boolean;
      refreshToken: string;
      idToken: string;
    }
  | {
      success: false;
      error: string;
      hint?: string | null;
    };

/**
 * Callbacks for the login flow
 */
export type LoginFlowCallbacks = {
  onAuthenticate: (args: {
    email: string;
    password: string;
  }) => Promise<AuthenticateResult>;
};

/**
 * Result of the login flow
 */
export type LoginFlowResult = {
  email: string;
  refreshToken: string;
  idToken: string;
  organizations: Array<string>;
  isAdmin: boolean;
} | null;

/**
 * Execute the interactive login flow
 *
 * This function handles the complete login UX:
 * 1. Shows intro message
 * 2. Collects email and password in a grouped prompt
 * 3. Shows spinner while authenticating
 * 4. Displays organization info in a note (if available)
 * 5. Shows outro message on success
 *
 * @param args - Flow configuration
 * @param args.callbacks - Callback functions for authentication
 * @param args.skipIntro - If true, skip the intro message (useful when called after another prompt)
 *
 * @returns Credentials on success, null on failure or cancellation
 */
export const loginFlow = async (args: {
  callbacks: LoginFlowCallbacks;
  skipIntro?: boolean | null;
}): Promise<LoginFlowResult> => {
  const { callbacks, skipIntro } = args;

  if (skipIntro !== true) {
    intro("Log in to Nori Skillsets");
  }

  const credentials = await group(
    {
      email: () =>
        text({
          message: "Email",
        }),
      password: () =>
        password({
          message: "Password",
        }),
    },
    {
      onCancel: () => {
        cancel("Login cancelled.");
      },
    },
  );

  if (isCancel(credentials)) {
    // onCancel handler already displayed the cancel message
    return null;
  }

  const s = spinner();
  s.start("Authenticating...");

  const result = await callbacks.onAuthenticate({
    email: credentials.email,
    password: credentials.password,
  });

  if (!result.success) {
    s.stop("Authentication failed");
    log.error(result.error);

    if (result.hint) {
      note(result.hint, "Hint");
    }

    return null;
  }

  s.stop("Authenticated");

  // Show organization info in a note if user has organizations
  if (result.organizations.length > 0) {
    const orgLines = [`Organizations: ${result.organizations.join(", ")}`];
    if (result.isAdmin) {
      orgLines.push("Admin: Yes");
    }
    note(orgLines.join("\n"), "Account Info");
  }

  outro(`Logged in as ${result.userEmail}`);

  return {
    email: credentials.email,
    refreshToken: result.refreshToken,
    idToken: result.idToken,
    organizations: result.organizations,
    isAdmin: result.isAdmin,
  };
};
