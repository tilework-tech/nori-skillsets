/**
 * Google OAuth authentication for CLI
 *
 * Implements the localhost HTTP server callback pattern for Google SSO.
 * Opens the user's browser to Google's consent screen, captures the
 * authorization code via redirect to localhost, and exchanges it for tokens.
 */

import * as crypto from "crypto";
import * as http from "http";
import * as net from "net";

import { formatNetworkError } from "@/utils/fetch.js";

/**
 * Google OAuth client credentials (Desktop app type).
 * For Desktop app type, the client secret is not truly secret -- this is
 * standard practice (same as firebase-tools, gcloud CLI, etc.).
 * Replace these with real values from Google Cloud Console.
 */
export const GOOGLE_OAUTH_CLIENT_ID =
  "199991289749-otcibgl0kp53qq2tn46n08iutm62pq6h.apps.googleusercontent.com";
export const GOOGLE_OAUTH_CLIENT_SECRET = "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";

/**
 * Validate that OAuth credentials have been configured.
 * Throws if still using placeholder values.
 *
 * @throws Error if credentials are still placeholders
 */
export const validateOAuthCredentials = (): void => {
  if (
    GOOGLE_OAUTH_CLIENT_ID.startsWith("PLACEHOLDER") ||
    GOOGLE_OAUTH_CLIENT_SECRET.startsWith("PLACEHOLDER")
  ) {
    throw new Error(
      "Google OAuth credentials are not configured. " +
        "Replace placeholder values in googleAuth.ts " +
        "with real values from the Google Cloud Console.",
    );
  }
};

/** Port range for the local OAuth callback server */
const START_PORT = 9876;
const MAX_PORT_ATTEMPTS = 10;

/** Timeout for waiting for the OAuth callback (ms) */
const AUTH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

/** Google OAuth endpoints */
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Result from the Google OAuth token exchange
 */
export type GoogleTokenResult = {
  idToken: string;
  accessToken: string;
};

/**
 * Find an available port starting from startPort
 *
 * @param args - Configuration arguments
 * @param args.startPort - Port to start checking from
 * @param args.maxAttempts - Maximum number of ports to try
 *
 * @throws Error if no port is available
 *
 * @returns An available port number
 */
export const findAvailablePort = async (args: {
  startPort?: number | null;
  maxAttempts?: number | null;
}): Promise<number> => {
  const startPort = args.startPort ?? START_PORT;
  const maxAttempts = args.maxAttempts ?? MAX_PORT_ATTEMPTS;

  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
    });

    if (available) {
      return port;
    }
  }

  throw new Error(
    `No available port found in range ${startPort}-${startPort + maxAttempts - 1}`,
  );
};

/**
 * Build the Google OAuth authorization URL
 *
 * @param args - Configuration arguments
 * @param args.clientId - Google OAuth client ID
 * @param args.redirectUri - Redirect URI (http://localhost:{port})
 * @param args.state - CSRF protection nonce
 *
 * @returns The full Google OAuth authorization URL
 */
export const getGoogleAuthUrl = (args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string => {
  const { clientId, redirectUri, state } = args;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
};

/** HTML page shown in the browser after authentication completes */
const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Authentication Successful</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px">
<h2>Authentication successful!</h2>
<p>You can close this tab and return to your terminal.</p>
</body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html><head><title>Authentication Failed</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px">
<h2>Authentication failed</h2>
<p>Please return to your terminal for more information.</p>
</body></html>`;

/**
 * Start a temporary HTTP server to capture the OAuth callback
 *
 * @param args - Configuration arguments
 * @param args.port - Port to listen on
 * @param args.expectedState - Expected state parameter for CSRF validation
 * @param args.timeoutMs - Timeout in milliseconds
 *
 * @throws Error on timeout, user cancellation, or CSRF mismatch
 *
 * @returns Promise resolving with the authorization code and server reference
 */
export const startAuthServer = (args: {
  port: number;
  expectedState: string;
  timeoutMs?: number | null;
}): Promise<{ code: string; server: http.Server }> => {
  const { port, expectedState, timeoutMs } = args;
  const timeout = timeoutMs ?? AUTH_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutHandle != null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      server.close();
      reject(err);
    };

    const server = http.createServer((req, res) => {
      if (settled) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML);
        return;
      }

      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      // Check for error from Google (e.g., user denied consent)
      const error = url.searchParams.get("error");
      if (error != null) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML);
        safeReject(new Error(`Authentication denied: ${error}`));
        return;
      }

      // Verify CSRF state parameter
      const state = url.searchParams.get("state");
      if (state !== expectedState) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML);
        safeReject(
          new Error("State parameter mismatch -- possible CSRF attack."),
        );
        return;
      }

      // Extract authorization code
      const code = url.searchParams.get("code");
      if (code == null) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML);
        safeReject(new Error("No authorization code received from Google."));
        return;
      }

      // Success -- caller is responsible for closing the server
      settled = true;
      cleanup();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);
      resolve({ code, server });
    });

    server.listen(port, () => {
      // Set up timeout
      timeoutHandle = setTimeout(() => {
        safeReject(
          new Error(
            "Authentication timed out. No response received from the browser.",
          ),
        );
      }, timeout);
    });
  });
};

/**
 * Exchange an authorization code for Google tokens
 *
 * @param args - Configuration arguments
 * @param args.code - Authorization code from OAuth callback
 * @param args.clientId - Google OAuth client ID
 * @param args.clientSecret - Google OAuth client secret
 * @param args.redirectUri - Redirect URI used in the auth request
 *
 * @throws Error if token exchange fails
 *
 * @returns Google tokens including id_token
 */
export const exchangeCodeForTokens = async (args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResult> => {
  const { code, clientId, clientSecret, redirectUri } = args;

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }).toString();

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (err) {
    // Network errors from fetch - wrap with helpful message
    if (err instanceof Error) {
      const networkError = formatNetworkError({
        error: err,
        url: GOOGLE_TOKEN_ENDPOINT,
      });
      throw new Error(`Google token exchange failed: ${networkError.message}`);
    }
    throw err;
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errorMsg =
      (data.error_description as string) ??
      (data.error as string) ??
      "Token exchange failed";
    throw new Error(`Google token exchange failed: ${errorMsg}`);
  }

  return {
    idToken: data.id_token as string,
    accessToken: data.access_token as string,
  };
};

/**
 * Generate a cryptographic nonce for CSRF protection
 *
 * @returns A random hex string
 */
export const generateState = (): string => {
  return crypto.randomBytes(16).toString("hex");
};
