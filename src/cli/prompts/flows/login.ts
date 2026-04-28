/**
 * Login flow module
 *
 * Provides the complete interactive login experience using @clack/prompts.
 * This flow handles:
 * - Intro message
 * - Sequential email/password collection
 * - Spinner during authentication
 * - Note display for organization info
 * - Outro message on success
 */

import { text, password, spinner, note, log } from "@clack/prompts";

import { bold } from "@/cli/logger.js";
import { unwrapPrompt } from "@/cli/prompts/flows/utils.js";

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
  statusMessage: string;
} | null;

const CANCEL_MESSAGE = "Login cancelled.";

/**
 * Execute the interactive login flow
 *
 * This function handles the complete login UX:
 * 1. Collects email and password
 * 2. Shows spinner while authenticating
 * 3. Displays organization info in a note (if available)
 *
 * @param args - Flow configuration
 * @param args.callbacks - Callback functions for authentication
 *
 * @returns Credentials on success, null on failure or cancellation
 */
export const loginFlow = async (args: {
  callbacks: LoginFlowCallbacks;
}): Promise<LoginFlowResult> => {
  const { callbacks } = args;

  const email = unwrapPrompt({
    value: await text({ message: "Email" }),
    cancelMessage: CANCEL_MESSAGE,
  });
  if (email == null) return null;

  const pwd = unwrapPrompt({
    value: await password({ message: "Password" }),
    cancelMessage: CANCEL_MESSAGE,
  });
  if (pwd == null) return null;

  const s = spinner();
  s.start("Authenticating...");

  const result = await callbacks.onAuthenticate({
    email,
    password: pwd,
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

  return {
    email,
    refreshToken: result.refreshToken,
    idToken: result.idToken,
    organizations: result.organizations,
    isAdmin: result.isAdmin,
    statusMessage: `Logged in as ${bold({ text: result.userEmail })}`,
  };
};
