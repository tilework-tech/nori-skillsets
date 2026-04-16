# API Token Authentication

**Goal:** Add API token support to nori-skillsets so private-org users can authenticate to their org's registrar (`{orgId}.noriskillsets.dev`) non-interactively, using tokens created via the registrar admin UI shipped in nori-registrar PR #329.

**Architecture:** Token format is `nori_<orgId>_<64hex>` — the orgId is embedded in the token itself, so the client never needs a separate `--org` flag or `NORI_ORG_ID` env var. Add `apiToken` to the `auth` block in `~/.nori-config.json`. Add `nori-skillsets login --token <value>` to write it. In the two registry-auth code paths (`AuthManager.getAuthToken` in `src/api/base.ts` and `getRegistryAuthToken` in `src/api/registryAuth.ts`), short-circuit the Firebase-refresh-token exchange when an API token exists whose embedded org matches the target URL's org. The `NORI_API_TOKEN` env var overrides config for CI and allows running with zero config file on disk.

**Tech Stack:** TypeScript, commander (CLI), AJV (config schema validation), vitest (tests). Firebase/refresh-token auth preserved unchanged for non-API-token paths.

---

## Background: Conversation That Led to This Spec

This spec is the product of two iterative design conversations. The headline thread and the pushback that shaped the final design are recorded below so future readers understand *why* the design landed where it did.

### Initial framing

User asked: "In the most recent PR to nori-registrar we added support for creating and authenticating with an API token. Now we want to add API token support to nori-skillsets. The obvious place to do it would be in the nori config. Propose an implementation."

### Server-side prior art (discovered in research)

Research of `nori-registrar` (sibling repo at `~/code/nori/nori-registrar`) surfaced PR #329 (`feat: add org-scoped API keys for programmatic access`, commit `76d6870`, merged 2026-04-16). Relevant findings the client must honor:

- **Token format:** `nori_<orgId>_<64 hex chars>`. The orgId is embedded in the token so the client can self-describe scope without a separate flag/env var. Generated via `crypto.randomBytes(32).toString('hex')` with the `nori_<orgId>_` prefix. Server stores only the SHA-256 hash; the raw key is returned exactly once at creation.
- **Transport:** `Authorization: Bearer <rawKey>`. On the server, tokens starting with `nori_` are routed to the API-key validation path (hash lookup in SQLite) instead of Firebase `verifyIdToken`.
- **Server-side constraint:** API keys are rejected unless `PRIVATE_INSTANCE_MODE && DEPLOYMENT_ID` are both set on the server. Public `noriskillsets.dev` apex will never accept API tokens.
- **Org scoping:** Each key is bound to one `orgId`. Cross-org requests return 403. On success, the server sets `req.user = { uid: 'api-key', organizations: [{ id: apiKey.orgId, roles: ['user'] }] }` and fire-and-forget updates `lastUsedAt`.
- **Management endpoints** (`/api/admin/api-keys` POST/GET/DELETE) are admin-only and live in the registrar admin UI. **Client-side creation/listing/revocation are explicitly out of scope** for this spec — they stay in the admin UI.

### First design iteration (org as separate flag)

The initial implementation used a separate `--org <orgId>` flag on login, stored `apiTokenOrgId` alongside `apiToken` in config, and required a paired `NORI_API_TOKEN` + `NORI_ORG_ID` env-var setup with a stderr warning for partial pairs. The user pushed back: *"would it be easier to instead have the org somehow scoped onto the token itself at generation time? For eg. if the format for every token was `nori_<org>_lksjdlfkjsdlf`?"*

After weighing tradeoffs — cleaner CLI, single env var, impossible to mis-scope, minor privacy tradeoff (org leaks via `ps`/logs), server-format change required — the user chose to adopt the embedded-org format. The rest of this spec reflects that decision.

### Final decisions

- **One flag, one env var.** `--token <nori_orgId_hex>` on login; `NORI_API_TOKEN` for CI. No `--org`, no `NORI_ORG_ID`.
- **Org parsed from the token** at login time (for URL derivation) and at every request (for scoping). No `apiTokenOrgId` stored in config — it's derivable.
- **Strict client-side scoping.** An API token whose embedded org is `acme` is NEVER sent to `foo`'s subdomain. Cross-org requests fall through to the Firebase refresh-token flow.
- **Reject `nori_public_<hex>` at login.** Defense in depth; server would also reject such tokens at creation time.
- `--verify` dropped: adds round-trip complexity and isn't necessary — if the token is bad, the next real call will 401.
- `chmod 0o600` on config writes deferred (worth doing, but applies equally to existing `refreshToken`/`password` and is better as a separate hardening PR).

---

## Testing Plan

All tests target observable behavior — what the CLI writes to config, which HTTP requests it makes, and what auth header a registry call carries — not internal control flow.

**Config schema & persistence** (`src/cli/config.test.ts`)
- Round-trip: `updateConfig({ auth: { organizationUrl, apiToken: "nori_acme_..." } })` followed by `loadConfig()` returns the same `apiToken` and `organizationUrl`.
- AJV's `additionalProperties: false` at the root still rejects unknown top-level fields; the `auth` block accepts the new `apiToken` field explicitly.
- Backwards compat: a config written before this PR (no `apiToken`) still loads; `auth.refreshToken` and `auth.username` remain reachable; Firebase-based behavior unchanged.
- Backwards compat: `username` becoming nullable does NOT break the Firebase flow — a config with `username` + `refreshToken` and no `apiToken` still loads and saves.
- `validateConfig()` treats a config with only `apiToken` + `organizationUrl` (no `username`/`password`/`refreshToken`) as valid.

**API token utility** (`src/utils/apiToken.test.ts`)
- `isValidApiToken({ token: 'nori_acme_<64 hex>' })` → true.
- `isValidApiToken({ token: 'nori_my-company_<64 hex>' })` → true (hyphenated orgId).
- Rejects missing org segment, uppercase orgId, wrong hex length, missing `nori_` prefix.
- `extractOrgIdFromApiToken` returns the orgId on a valid token, null otherwise.

**`login --token` command** (`src/cli/commands/login/login.test.ts`)
- Given `--token nori_acme_<64hex>`, writes `auth.apiToken`, `auth.organizationUrl: "https://acme.noriskillsets.dev"` to config. Clears `refreshToken`/`password`/`username`.
- Rejects token whose embedded org is `public` with a registrar-aware message.
- Rejects malformed token (missing org segment, completely garbage) with non-zero exit, pointing at the expected `nori_<orgId>_<64-hex>` shape.
- `--token` is mutually exclusive with `--email`/`--password`/`--google`. Passing two auth modes exits non-zero.
- Legal combination: plain `nori-skillsets login` (no flags) still runs the existing interactive Firebase flow unchanged.
- Overwriting an existing Firebase session emits a stderr warning so the user notices the session was cleared.

**`logout` command** (`src/cli/commands/logout/logout.test.ts`)
- After an `apiToken`-only login, `logout` clears `auth` to null (including `apiToken`). Existing behavior extended to cover the new field.

**Auth resolution — `AuthManager.getAuthToken`** (`src/api/base.test.ts`)
- With `config.auth.apiToken = "nori_acme_AAA..."`, `organizationUrl = https://acme.noriskillsets.dev`: calling `apiRequest({ path: "/skillsets/foo" })` issues a request to `https://acme.noriskillsets.dev/api/skillsets/foo` with `Authorization: Bearer nori_acme_AAA...`. `exchangeRefreshToken` is never called.
- `NORI_API_TOKEN=nori_acme_BBB...` env var takes precedence over config when both are present and the token's embedded org matches the target URL's org.
- Env-var token with mismatched embedded org (e.g. `nori_other_...`) falls through to config's apiToken (or refresh-token exchange if no config-level token).
- With `config.auth.refreshToken` set and no `apiToken`, behavior is unchanged (refresh-token exchange path).
- Config with neither apiToken nor refreshToken/password still throws the existing "not configured" error.
- Malformed `NORI_API_TOKEN` (e.g. `"not-a-valid-token"`) is silently ignored (treated as unset).
- **Cross-org scoping invariant:** calling `apiRequest({ baseUrl: "https://foo.noriskillsets.dev", path: ... })` with `config.auth.apiToken = "nori_acme_..."` does NOT send the acme token to foo's subdomain. It falls through to the refresh-token flow.

**Auth resolution — `getRegistryAuthToken`** (`src/api/registryAuth.test.ts`)
- Parallel to `base.ts` tests: when `registryAuth.apiToken`'s embedded org matches the target `registryUrl`'s org, return the raw token without calling `exchangeRefreshToken`. Token is NOT cached (API tokens are long-lived; the cache would risk staleness across env changes in the same process).
- Cross-org scoping: calling `getRegistryAuthToken` with a `registryUrl` for org `foo` while the apiToken is `nori_acme_...` falls through to the refresh-token flow — not the apiToken.
- Env-var API token with matching embedded org takes precedence over config's apiToken.

**`getRegistryAuth` (config.ts helper)** (`src/cli/config.test.ts`)
- When asked for auth for a registry URL whose orgId matches the orgId embedded in `auth.apiToken`, the returned `RegistryAuth` carries `apiToken`. When the URL matches but no apiToken is set, returns `refreshToken` as before.

NOTE: Tests were written before the implementation per the TDD skill.

---

## Implementation Tasks

### Task 1 — API token utility

**Files:** `src/utils/apiToken.ts` (new)

1. Export `API_TOKEN_PATTERN = /^nori_([a-z0-9]+(?:-[a-z0-9]+)*)_([a-f0-9]{64})$/`.
2. Export `isValidApiToken({ token }): boolean`.
3. Export `extractOrgIdFromApiToken({ token }): string | null`.

### Task 2 — Extend config types and schema

**Files:** `src/cli/config.ts`

1. Extend `AuthCredentials` with `apiToken?: string | null`. Change `username` from required to `username?: string | null` (still nullable for API-token-only configs).
2. Extend `RawDiskConfig.auth` with the same field.
3. JSON schema: add `apiToken: { type: ["string", "null"] }` under `auth.properties`. Remove `username` from `auth.required` (leave `organizationUrl` required).
4. `loadConfig`: extend the "new nested format" branch to carry `apiToken`. Accept auth blocks with `apiToken` + `organizationUrl` even without `username`. Legacy flat format stays untouched (no apiToken support for legacy).
5. `saveConfig`: add `apiToken?: string | null` argument. Write it into the nested `auth` block when provided.
6. `updateConfig`: thread the new field through. Same "if 'auth' in updates use it wholesale, else preserve existing" semantics already in place.
7. `getRegistryAuth`: return `apiToken` in `RegistryAuth` only when the orgId parsed from `auth.apiToken` matches the target URL's orgId. Otherwise return it as null. Update `RegistryAuth` type to include `apiToken?: string | null`.
8. `validateConfig`: loosen to accept a config with `organizationUrl` AND at least one of (`username` + (`password` | `refreshToken`)) OR `apiToken`. The flat-legacy checks stay as-is.

### Task 3 — Teach the API layer about API tokens

**Files:** `src/api/base.ts`, `src/api/registryAuth.ts`

1. In `src/api/base.ts`:
   - Extend `NoriConfig` type with `apiToken?: string | null`.
   - Export `readApiTokenEnv()`: reads `NORI_API_TOKEN`, validates shape via `isValidApiToken`, returns `{ token, orgId }` (orgId parsed from token) or null.
   - `ConfigManager.loadConfig()`: extract `apiToken` from the nested `auth` block.
   - `ConfigManager.isConfigured()`: treat `config.apiToken != null && config.organizationUrl != null` as configured, even without `username`. Also treat `readApiTokenEnv()` returning non-null as configured.
   - `AuthManager.getAuthToken({ targetUrl? })`:
     - Accept optional `targetUrl` so cross-org scoping holds even when `apiRequest` is called with explicit `baseUrl`.
     - Compute `targetOrgId = extractOrgId({ url: targetUrl ?? config.organizationUrl ?? buildOrganizationRegistryUrl({ orgId: envApi.orgId }) })`.
     - If `readApiTokenEnv()` is non-null AND its orgId matches `targetOrgId`, return the env token (no caching).
     - Else if `config.apiToken` is set AND `extractOrgIdFromApiToken({ token: config.apiToken }) === targetOrgId`, return `config.apiToken` directly (no caching).
     - Else fall through to existing refresh-token and password branches.
   - Relax the "not configured" error to mention `apiToken`.
   - When `organizationUrl` is not in config but env var is set, derive `organizationUrl` via `buildOrganizationRegistryUrl({ orgId: envApi.orgId })` so env-var-only CI usage works with no config file on disk.
   - `apiRequest`: pass `effectiveBaseUrl` as `targetUrl` to `getAuthToken`.
2. In `src/api/registryAuth.ts`:
   - Extend `getRegistryAuthToken` with the same precedence. Input is `RegistryAuth` (which now carries `apiToken`). Early-return the raw API token (env var wins if target matches) before falling through to the refresh-token exchange.
   - Skip `tokenCache` entirely for API-token responses.
3. Callers of `getRegistryAuth` / `getRegistryAuthToken` need no changes — the `RegistryAuth` type expansion is transparent; the `Authorization: Bearer ...` envelope is identical.

### Task 4 — Extend the `login` command

**Files:** `src/cli/commands/login/login.ts`, `src/cli/commands/noriSkillsetsCommands.ts` (command registration)

1. Add commander option `--token <value>` to `login`.
2. At top of the command handler, detect `--token`:
   - Reject combination with `--email`/`--password`/`--google`.
   - Validate `--token` via `isValidApiToken`. Error out on mismatch.
   - Extract orgId via `extractOrgIdFromApiToken`.
   - Reject if parsed org is `public` with a registrar-aware message.
3. Build URL via `buildOrganizationRegistryUrl({ orgId })`.
4. Write config via `updateConfig({ auth: { organizationUrl, apiToken: token, username: null, refreshToken: null, password: null, organizations: [orgId], isAdmin: null } })`.
5. Success message: `Logged in with API token for org '<orgId>'.`.
6. Emit stderr warning (`log.warn`) when an existing Firebase session is overwritten.
7. **No `--verify` flag.** If the token is invalid, the next real registry call will 401 with the registrar's own error message.

### Task 5 — Extend `logout`

**Files:** `src/cli/commands/logout/logout.ts`

No structural change needed — `updateConfig({ auth: null })` already wipes the whole block. Task 2's tests cover the new field being cleared.

### Task 6 — Documentation

**Files:** `src/cli/commands/login/docs.md`, any README/docs touched by the `updating-noridocs` skill.

1. Document the `--token` flag in `login/docs.md` and the token format.
2. Document `NORI_API_TOKEN` env var.
3. Note the public-registry constraint: API tokens require a private org (enforced at both creation and login time).
4. Called from the `updating-noridocs` skill at end of development.

---

## Edge Cases

1. **Config with both `apiToken` and `refreshToken` set, hitting `apiToken`'s org subdomain:** apiToken wins (scoped match). Both stored is allowed and may occur during credential rotation. Covered by tests.
2. **Config with `apiToken` for org `acme`, request for org `foo`'s subdomain:** falls through to refresh-token. If no refresh token, fails with the existing "not configured" error. We do not silently reuse the wrong-org apiToken — server would 403 anyway, and we should fail faster client-side when the mismatch is knowable.
3. **Malformed `NORI_API_TOKEN`:** silently ignored (treated as unset). The token format is self-validating; there's no partial state to warn about.
4. **`NORI_API_TOKEN` set but no config file on disk:** derive `organizationUrl` from the orgId embedded in the token at request time. CI works with zero config. `ConfigManager.isConfigured()` must account for this.
5. **Case in orgId:** server uses case-insensitive compare. Client-side, `isValidOrgId` + the token regex require lowercase. Keep the client strict and lowercase-only to avoid ambiguity.
6. **Trailing slash in `organizationUrl` vs derived URL during `extractOrgId` comparison:** already normalized by existing `normalizeUrl`. Unchanged.
7. **Legacy flat-format config:** does not support apiToken. If a user has a legacy config and runs `login --token`, the save path writes the new nested format (matches existing migration behavior).
8. **Running `login --token` while already logged in via Firebase:** we clear `refreshToken`/`password`/`username`. This is destructive for the user's Firebase session. A stderr warning (`log.warn`) is emitted so they notice. No `--keep-session` flag — out of scope.

---

## Backwards Compatibility

- Existing configs without `apiToken` load and save unchanged.
- Existing `username`-required invariants relax to `organizationUrl`-required + any one credential. All current Firebase and password flows still produce valid configs under the looser schema.
- `RegistryAuth` type expansion is additive; all existing consumers compile without change.
- `saveConfig` signature grows one optional param (`apiToken?`), so callers that don't pass it are unaffected.
- AJV's `removeAdditional: true` is preserved. New field added explicitly to the schema.
- No changes to HTTP wire format — `Authorization: Bearer <value>` envelope is identical.
- Legacy flat-format configs continue to load; they simply don't support API tokens until migrated (writing a nested format happens automatically on the first `updateConfig` call).

---

## Deferred / Out of Scope

- CLI-side token creation, listing, or revocation. These are admin-only and live in the nori-registrar admin UI.
- `chmod 0o600` on config writes. Worth doing, but applies equally to the existing `refreshToken`/`password` fields; best addressed as a separate hardening PR.
- `--verify` flag on `login --token`. A real call will 401 if the token is bad — sufficient feedback.
- Special-case display in `nori-skillsets current` (which is a local skillset selector, unrelated to auth).

---

**Testing Details** All tests target behavior observable at the boundary of the unit under test: config on disk after a save, HTTP request shape after a registry call, exit code + stderr for CLI flag validation. No test inspects the implementation's internal variables. Mocks are limited to `fetch` (for registry-call tests) and `process.env` (for env-var precedence). The most important single test is the integration test proving `NORI_API_TOKEN` alone, with zero config file, lets a registry call succeed carrying the raw token as Bearer — the concrete CI use case. A second critical test guards the cross-org scoping invariant: `apiRequest` with a `baseUrl` for `foo` must NOT send an `acme`-scoped API token to foo's subdomain.

**Implementation Details**
- New config field: `auth.apiToken`. `auth.username` becomes nullable. Token format is `nori_<orgId>_<64hex>`.
- New env var: `NORI_API_TOKEN`. The orgId is parsed from the token — no separate env var needed.
- New CLI flag: `--token` on `login`. Mutually exclusive with existing auth-method flags. No `--verify`.
- Auth resolution precedence per request: env-var token (if embedded org matches target) > config apiToken (if embedded org matches target) > refreshToken exchange > password.
- Target org derived from URL via existing `extractOrgId`; URL derived from orgId via existing `buildOrganizationRegistryUrl`. OrgId derived from token via new `extractOrgIdFromApiToken`. No new URL plumbing.
- Server PR #329 reject-on-public behavior is mirrored client-side by rejecting tokens whose embedded org is `public` at login time.
- AJV schema stays strict (`additionalProperties: false` at root); new field added explicitly.
- No changes to HTTP client layer — the `Authorization: Bearer ...` envelope is unchanged.
- No token cache for API tokens; existing Firebase-id-token cache remains.
- `logout` requires no code change; existing `updateConfig({ auth: null })` wipes the new field too.

**Question** Open items resolved during the conversation — no remaining questions before implementation. Re-open if any edge case above is contested during TDD.

---
