/**
 * Refresh token exchange functionality
 * Uses Firebase REST API to exchange refresh tokens for ID tokens
 *
 * Note: The Firebase SDK doesn't expose a direct "exchange refresh token" method
 * for stateless CLI use. The SDK handles this internally via user.getIdToken(),
 * but that requires an active User session. For CLI tools that store refresh tokens
 * and need to exchange them on cold start, we use the REST API directly.
 *
 * Sign-in with email/password uses the Firebase SDK (see loader.ts).
 */

// Firebase API key from tilework-e18c5 project
const FIREBASE_API_KEY = "AIzaSyC54HqlGrkyANVFKGDQi3LobO5moDOuafk";
const TOKEN_ENDPOINT = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

// Token cache: refreshToken -> { idToken, expiry }
const tokenCache = new Map<string, { idToken: string; expiry: number }>();

/**
 * Result from exchanging a refresh token
 */
export type RefreshTokenResult = {
  idToken: string;
  refreshToken: string;
  expiresIn: number;
};

/**
 * Error response from Firebase REST API
 */
type FirebaseErrorResponse = {
  error: {
    code: number;
    message: string;
  };
};

/**
 * Success response from Firebase REST API
 */
type FirebaseTokenResponse = {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  token_type: string;
  user_id: string;
  project_id: string;
};

/**
 * Exchange a Firebase refresh token for a new ID token
 * @param args - The exchange parameters
 * @param args.refreshToken - The refresh token to exchange
 *
 * @returns The new ID token and refresh token
 */
export const exchangeRefreshToken = async (args: {
  refreshToken: string;
}): Promise<RefreshTokenResult> => {
  const { refreshToken } = args;

  // Check cache first
  const cached = tokenCache.get(refreshToken);
  if (cached && Date.now() < cached.expiry) {
    return {
      idToken: cached.idToken,
      refreshToken: refreshToken, // Refresh token doesn't change in cache
      expiresIn: Math.floor((cached.expiry - Date.now()) / 1000),
    };
  }

  // Exchange refresh token for new ID token via Firebase REST API
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });

  const data = await response.json();

  if (!response.ok) {
    const errorData = data as FirebaseErrorResponse;
    throw new Error(errorData.error?.message || "Token exchange failed");
  }

  const tokenData = data as FirebaseTokenResponse;
  const expiresIn = parseInt(tokenData.expires_in, 10);

  // Cache the token with expiry (subtract 5 minutes for safety buffer)
  const expiryBuffer = 5 * 60 * 1000; // 5 minutes in milliseconds
  tokenCache.set(refreshToken, {
    idToken: tokenData.id_token,
    expiry: Date.now() + expiresIn * 1000 - expiryBuffer,
  });

  return {
    idToken: tokenData.id_token,
    refreshToken: tokenData.refresh_token,
    expiresIn,
  };
};

/**
 * Clear the refresh token cache
 * Useful for testing
 */
export const clearRefreshTokenCache = (): void => {
  tokenCache.clear();
};
