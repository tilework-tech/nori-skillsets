/**
 * Refresh token exchange functionality
 * Uses Firebase REST API to exchange refresh tokens for ID tokens
 * and to sign in with email/password to get initial refresh tokens
 */

// Firebase API key from tilework-e18c5 project
const FIREBASE_API_KEY = "AIzaSyC54HqlGrkyANVFKGDQi3LobO5moDOuafk";
const TOKEN_ENDPOINT = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const SIGN_IN_ENDPOINT = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

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

/**
 * Result from signing in with email/password
 */
export type SignInResult = {
  idToken: string;
  refreshToken: string;
  email: string;
  expiresIn: number;
};

/**
 * Sign in response from Firebase REST API
 */
type FirebaseSignInResponse = {
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  registered: boolean;
};

/**
 * Sign in with email and password to get a refresh token
 * This is used during initial login to obtain a refresh token that can be stored
 * instead of the password.
 *
 * @param args - The sign-in parameters
 * @param args.email - The user's email address
 * @param args.password - The user's password
 *
 * @returns The refresh token and other authentication data
 */
export const signInWithPassword = async (args: {
  email: string;
  password: string;
}): Promise<SignInResult> => {
  const { email, password } = args;

  const response = await fetch(SIGN_IN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorData = data as FirebaseErrorResponse;
    throw new Error(errorData.error?.message || "Sign in failed");
  }

  const signInData = data as FirebaseSignInResponse;

  return {
    idToken: signInData.idToken,
    refreshToken: signInData.refreshToken,
    email: signInData.email,
    expiresIn: parseInt(signInData.expiresIn, 10),
  };
};
