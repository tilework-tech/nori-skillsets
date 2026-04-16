# Noridoc: login

Path: @/src/cli/commands/login

### Overview

- Authenticates users against the Nori registrar and persists credentials into the nested `auth` block of `~/.nori-config.json`.
- Supports three authentication modes: email/password (Firebase), Google SSO (Firebase OAuth), and API token (programmatic / CI access to a private-org registrar).
- All three modes are reachable from both the flag-driven path (`--token`, `--google`, `--email`/`--password`) and the interactive clack `select` menu. The interactive "API Token" entry was added so users who run `sks login` without flags can still pick token auth without rerunning the command.
- `loginMain` branches on flag presence: `--token` short-circuits all Firebase logic; otherwise it falls through to the interactive auth-method select or the flag-specified Firebase flow.

### How it fits into the larger codebase

- Registered as `login` via `@/src/cli/commands/noriSkillsetsCommands.ts` with `wrapWithFraming`. The same `--token` option is also registered on the primary CLI wiring path.
- Writes config via `updateConfig({ auth: ... })` from `@/src/cli/config.ts`. The credentials it writes are consumed downstream by `@/src/api/base.ts` (`AuthManager.getAuthToken`) and `@/src/api/registryAuth.ts` (`getRegistryAuthToken`) for every authenticated registry call.
- Firebase flows depend on `@/src/providers/firebase.ts` and `googleAuth.ts` (OAuth helpers). The API-token branch has no Firebase dependency — it never calls `configureFirebase()` and does not mint an ID token.
- Token parsing and validation are provided by `isValidApiToken` and `extractOrgIdFromApiToken` from `@/src/utils/apiToken.ts`. URL construction for the API-token branch uses `buildOrganizationRegistryUrl` from `@/src/utils/url.ts`.
- `logout` (`@/src/cli/commands/logout/`) requires no code changes to support API tokens — its existing `updateConfig({ auth: null })` clears the entire nested `auth` block including `apiToken`.

### Core Implementation

API-token persistence logic (shape validation, orgId extraction, `public` rejection, config write, Firebase-session-overwrite warning) lives in the module-private `loginWithApiToken({ token })` helper. Both the `--token` CLI flag branch and the interactive "API Token" selection call this helper, so error messages and side effects are identical across entry points. The mutual-exclusion check against `--email`/`--password`/`--google` remains outside the helper on the flag-parsing path — interactive selection is mutually exclusive by construction.

`loginMain` checks flag combinations in this order:

1. **API-token flag branch** (`token != null`): evaluated before all other paths. Enforces mutual exclusion with `--email`/`--password`/`--google`, then delegates to `loginWithApiToken`.

2. **Firebase Google SSO** (`--google`): either `authenticateWithGoogleLocalhost` (Desktop OAuth client, localhost callback server) or `authenticateWithGoogleHeadless` (Web OAuth client, hosted callback page, user pastes ID token). Environment detection via `isHeadlessEnvironment()` prompts the user to pick between flows when SSH/headless is detected.

3. **Firebase email/password non-interactive** (`nonInteractive && --email && --password`): direct `signInWithEmailAndPassword`.

4. **Interactive auth-method selection**: a clack `select` prompt offers three options — `email` (Email / Password), `google` (Google SSO), and `token` (API Token).
   - `email` → `loginFlow` from `@/src/cli/prompts/flows/` (email/password).
   - `google` → `authenticateWithGoogle`.
   - `token` → masked `promptPassword` with placeholder `nori_<orgId>_<64 hex chars>`, then `loginWithApiToken`. On success, a `note("Organizations: <orgId>", "Account Info")` is displayed. On failure the error message from the helper is surfaced via `log.error` and returned, so no Firebase fallback occurs.

For all Firebase paths, `fetchUserAccess` calls `/api/auth/check-access` with the minted ID token to populate `auth.organizations` and `auth.isAdmin`. The API-token path bypasses this entirely — `auth.organizations` is seeded from the orgId parsed from the token and no network call is made.

**`loginWithApiToken` contract:**

- Validates token shape via `isValidApiToken` (`nori_<orgId>_<64 hex chars>`, where `orgId` follows `isValidOrgId` rules).
- Parses the orgId via `extractOrgIdFromApiToken` and rejects `public` explicitly (the server only accepts API tokens on private-instance deployments with `PRIVATE_INSTANCE_MODE && DEPLOYMENT_ID` set).
- On success, derives `organizationUrl = https://{orgId}.noriskillsets.dev` via `buildOrganizationRegistryUrl` and writes:

  ```
  auth: {
    username: null,
    organizationUrl,
    apiToken: token,
    refreshToken: null,  // explicitly cleared
    password: null,       // explicitly cleared
    organizations: [orgId],
    isAdmin: null,
  }
  ```

- Destructive for any existing Firebase session — `refreshToken`/`password`/`username` are wiped. If an existing Firebase session is detected (`auth.refreshToken != null || auth.password != null`), a one-shot `log.warn` announces the clear. Error messages are flag-agnostic ("Invalid API token…") because the helper serves both the flag and interactive callers.

### Things to Know

- `loginWithApiToken` is the single source of truth for API-token credential writes. Any future caller that wants to persist an API token must go through it to preserve the Firebase-session-overwrite warning and the `organizations: [orgId]` seeding.
- Token validation order (shape via `isValidApiToken` → parse orgId via `extractOrgIdFromApiToken` → reject `public`) matters because error messages differ for each failure mode. The public-org check is separate from shape validation because `"public"` is a syntactically valid orgId but semantically forbidden for API tokens.
- API-token login skips all network activity. Token validity is only verified on the next real registry call (which will 401 if invalid). No `--verify` flag exists — the server's 401 is the authoritative signal.
- The `auth.organizations` field is set to `[orgId]` on API-token login (where `orgId` is parsed from the token) even though the server's `req.user` for API-key requests synthesizes `organizations: [{ id: apiKey.orgId, roles: ["user"] }]`. This makes the client-side `hasUnifiedAuthWithOrgs` check (used by upload authorization in `@/src/cli/commands/registry-upload/`) behave consistently with Firebase sessions.
- `--token` requires the nested `auth` format. If a user's existing config is in legacy flat format, `updateConfig` writes the new nested format on save — matching the existing migration behavior for Firebase refresh tokens.
- The commander action handler coerces falsy inputs to `null` (`options.token || null`) so empty strings do not reach `loginMain`.

Created and maintained by Nori.
