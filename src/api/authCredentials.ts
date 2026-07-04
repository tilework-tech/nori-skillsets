/**
 * Registry credential shapes and pure credential helpers.
 * CLI-free home so core modules can consume them without importing src/cli/.
 */

/**
 * Registry authentication credentials
 * Supports both legacy password auth and new refresh token auth.
 * If `apiToken` is set, the orgId is parsed from the token itself (see `extractOrgIdFromApiToken`).
 */
export type RegistryAuth = {
  username: string | null;
  registryUrl: string;
  refreshToken?: string | null;
  idToken?: string | null;
  idTokenExpiresAt?: number | null;
  apiToken?: string | null;
};

/**
 * Authentication credentials - supports legacy password, refresh token, and API token auth.
 * API tokens are self-describing: the orgId is embedded in the token format `nori_<orgId>_<64hex>`.
 */
export type AuthCredentials = {
  // Username is optional (null) for API-token-only configs where no Firebase identity is tied
  username?: string | null;
  organizationUrl: string;
  // Token-based auth (preferred for user accounts)
  refreshToken?: string | null;
  // Short-lived Firebase ID token for broker-managed session machines.
  idToken?: string | null;
  idTokenExpiresAt?: number | null;
  // Legacy password-based auth (deprecated, will be removed)
  password?: string | null;
  // API token for non-interactive / programmatic access. Format: nori_<orgId>_<64hex>.
  apiToken?: string | null;
  // Organizations the user has access to
  organizations?: Array<string> | null;
  // Whether the user is an admin for their organization
  isAdmin?: boolean | null;
};

export const hasUnexpiredRegistryIdToken = (args: {
  auth?: AuthCredentials | null;
  now?: number | null;
}): boolean => {
  const { auth, now = Date.now() } = args;
  const effectiveNow = now ?? Date.now();

  return (
    auth?.idToken != null &&
    auth.idToken !== "" &&
    typeof auth.idTokenExpiresAt === "number" &&
    effectiveNow < auth.idTokenExpiresAt
  );
};

export const hasRegistryAuthCredentials = (args: {
  auth?: AuthCredentials | null;
  now?: number | null;
}): boolean => {
  const { auth, now } = args;

  return (
    auth != null &&
    (auth.refreshToken != null ||
      auth.apiToken != null ||
      hasUnexpiredRegistryIdToken({ auth, now }))
  );
};

export const toRegistryAuth = (args: {
  auth: AuthCredentials;
  registryUrl: string;
}): RegistryAuth => {
  const { auth, registryUrl } = args;

  return {
    registryUrl,
    username: auth.username ?? null,
    refreshToken: auth.refreshToken ?? null,
    ...(auth.idToken != null ? { idToken: auth.idToken } : {}),
    ...(auth.idTokenExpiresAt != null
      ? { idTokenExpiresAt: auth.idTokenExpiresAt }
      : {}),
    apiToken: auth.apiToken ?? null,
  };
};
