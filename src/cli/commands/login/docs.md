# Noridoc: login

Path: @/src/cli/commands/login

### Overview

- Authenticates users against the Nori registrar and persists credentials into the nested `auth` block of `~/.nori-config.json`.
- Supports three authentication modes: email/password (Firebase), Google SSO (Firebase OAuth), and API token (programmatic / CI access to a private-org registrar).
- `loginMain` branches on flag presence: `--token` short-circuits all Firebase logic; otherwise it falls through to Firebase email/password or Google SSO flows.

### How it fits into the larger codebase

- Registered as `login` via `@/src/cli/commands/noriSkillsetsCommands.ts` with `wrapWithFraming`. The same `--token` / `--org` options are also registered on the primary CLI wiring path.
- Writes config via `updateConfig({ auth: ... })` from `@/src/cli/config.ts`. The credentials it writes are consumed downstream by `@/src/api/base.ts` (`AuthManager.getAuthToken`) and `@/src/api/registryAuth.ts` (`getRegistryAuthToken`) for every authenticated registry call.
- Firebase flows depend on `@/src/providers/firebase.ts` and `googleAuth.ts` (OAuth helpers). The API-token branch has no Firebase dependency — it never calls `configureFirebase()` and does not mint an ID token.
- URL construction for the API-token branch uses `buildOrganizationRegistryUrl` from `@/src/utils/url.ts`; org validation uses `isValidOrgId` from the same module.
- `logout` (`@/src/cli/commands/logout/`) requires no code changes to support API tokens — its existing `updateConfig({ auth: null })` clears the entire nested `auth` block including `apiToken`/`apiTokenOrgId`.

### Core Implementation

`loginMain` checks flag combinations in this order:

1. **API-token branch** (`token != null`): evaluated before all other paths. Validates:
   - Mutually exclusive with `--email`, `--password`, `--google`.
   - `--org <orgId>` is required.
   - Token matches `/^nori_[a-f0-9]{64}$/` (matches server-side format from nori-registrar PR #329 — `nori_` + 64 hex chars from `crypto.randomBytes(32)`).
   - `--org public` is explicitly rejected because the server only accepts API tokens when `PRIVATE_INSTANCE_MODE && DEPLOYMENT_ID` are both set on the deployment; the public apex always rejects.
   - Org id passes `isValidOrgId` (lowercase alphanumeric with hyphens).

   On success, derives `organizationUrl = https://{org}.noriskillsets.dev` via `buildOrganizationRegistryUrl` and writes the nested `auth` block:

   ```
   auth: {
     username: null,
     organizationUrl,
     apiToken: token,
     apiTokenOrgId: org,
     refreshToken: null,  // explicitly cleared
     password: null,       // explicitly cleared
     organizations: [org],
     isAdmin: null,
   }
   ```

   This is destructive for any existing Firebase session — `refreshToken`/`password`/`username` are wiped.

2. **Firebase Google SSO** (`--google`): either `authenticateWithGoogleLocalhost` (Desktop OAuth client, localhost callback server) or `authenticateWithGoogleHeadless` (Web OAuth client, hosted callback page, user pastes ID token). Environment detection via `isHeadlessEnvironment()` prompts the user to pick between flows when SSH/headless is detected.

3. **Firebase email/password non-interactive** (`nonInteractive && --email && --password`): direct `signInWithEmailAndPassword`.

4. **Firebase interactive**: prompts for auth method (email vs Google), then either `loginFlow` (email/password via `@/src/cli/prompts/flows/`) or `authenticateWithGoogle`.

For all Firebase paths, `fetchUserAccess` calls `/api/auth/check-access` with the minted ID token to populate `auth.organizations` and `auth.isAdmin`.

### Things to Know

- The `--token` / `--org` validation order (token format → org presence → `--org public` check → `isValidOrgId`) matters because error messages differ. The public-org check is separate from `isValidOrgId` because `"public"` is a syntactically valid org id but semantically forbidden for API tokens.
- API-token login skips all network activity. Token validity is only verified on the next real registry call (which will 401 if invalid). No `--verify` flag exists — the server's 401 is the authoritative signal.
- The `auth.organizations` field is set to `[org]` on API-token login even though the server's `req.user` for API-key requests synthesizes `organizations: [{ id: apiKey.orgId, roles: ["user"] }]`. This makes the client-side `hasUnifiedAuthWithOrgs` check (used by upload authorization in `@/src/cli/commands/registry-upload/`) behave consistently with Firebase sessions.
- `--token` requires the nested `auth` format. If a user's existing config is in legacy flat format, `updateConfig` writes the new nested format on save — matching the existing migration behavior for Firebase refresh tokens.
- The commander action handler coerces falsy inputs to `null` (`options.token || null`, `options.org || null`) so empty strings do not reach `loginMain`.

Created and maintained by Nori.
