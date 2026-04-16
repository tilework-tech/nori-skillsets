# API Token Authentication

**Goal:** Add API token support to nori-skillsets so private-org users can authenticate to their org's registrar (`{orgId}.noriskillsets.dev`) non-interactively, using tokens created via the registrar admin UI shipped in nori-registrar PR #329.

**Architecture:** Add `apiToken` + `apiTokenOrgId` to the `auth` block in `~/.nori-config.json`. Add `nori-skillsets login --token <value> --org <orgId>` to write them. In the two registry-auth code paths (`AuthManager.getAuthToken` in `src/api/base.ts` and `getRegistryAuthToken` in `src/api/registryAuth.ts`), short-circuit the Firebase-refresh-token exchange when an API token exists for the target org. Env vars `NORI_API_TOKEN` + `NORI_ORG_ID` override config for CI and allow running with zero config file on disk.

**Tech Stack:** TypeScript, commander (CLI), AJV (config schema validation), vitest (tests). Firebase/refresh-token auth preserved unchanged for non-API-token paths.

---

## Background: Conversation That Led to This Spec

This spec is the product of an iterative design conversation. The headline thread and the pushback that shaped the final design are recorded below so future readers understand *why* the design landed where it did.

### Initial framing

User asked: "In the most recent PR to nori-registrar we added support for creating and authenticating with an API token. Now we want to add API token support to nori-skillsets. The obvious place to do it would be in the nori config. Propose an implementation."

### Server-side prior art (discovered in research)

Research of `nori-registrar` (sibling repo at `~/code/nori/nori-registrar`) surfaced PR #329 (`feat: add org-scoped API keys for programmatic access`, commit `76d6870`, merged 2026-04-16). Relevant findings the client must honor:

- **Token format:** `nori_` + 64 hex chars. Generated via `crypto.randomBytes(32).toString('hex')` with the `nori_` prefix. Server stores only the SHA-256 hash; the raw key is returned exactly once at creation.
- **Transport:** `Authorization: Bearer <rawKey>`. On the server, tokens starting with `nori_` are routed to the API-key validation path (hash lookup in SQLite) instead of Firebase `verifyIdToken`.
- **Server-side constraint:** API keys are rejected unless `PRIVATE_INSTANCE_MODE && DEPLOYMENT_ID` are both set on the server. Public `noriskillsets.dev` apex will never accept API tokens.
- **Org scoping:** Each key is bound to one `orgId`. Cross-org requests return 403. On success, the server sets `req.user = { uid: 'api-key', organizations: [{ id: apiKey.orgId, roles: ['user'] }] }` and fire-and-forget updates `lastUsedAt`.
- **Management endpoints** (`/api/admin/api-keys` POST/GET/DELETE) are admin-only and live in the registrar admin UI. **Client-side creation/listing/revocation are explicitly out of scope** for this spec — they stay in the admin UI.

### Initial set of six design decisions (user signed off)

1. Env var name: `NORI_API_TOKEN` (parallels `NORI_GLOBAL_CONFIG`, `NORI_NO_ANALYTICS`).
2. CLI surface: reuse `login --token <value>` (no new `auth` subcommand).
3. Token validation: client-side `/^nori_[a-f0-9]{64}$/` check for good error messages; server handles the rest.
4. Public-registry misuse: let the 401 happen (don't pre-warn at every call).
5. Originally: ship a `--verify` round-trip at login time. **Later dropped per user feedback (see below).**
6. Out of scope confirmed: no CLI-side token creation, listing, or revocation.

### First correction: "how do we get the org that the token is authed for?"

First draft of the plan assumed the token would carry the org somehow, or that a `/whoami` endpoint could be called. User pushed back. Key discovery: the token is opaque (`nori_<hex>`) and there is no central identity service to query — each registrar is independent.

### Second correction: single-tenant misreading

Second draft assumed the registrar was single-tenant per deployment, with `organizationUrl` being user-supplied as an arbitrary URL (`--registry-url`). User pushed back again: *"your understanding of the existing setup is wrong. Go back and read the code again. Look for the orgs and how those get mapped to registry urls."*

### Actual architecture (read from code)

Re-reading `src/utils/url.ts` and `src/cli/config.ts` directly revealed the real architecture:

- **Multi-tenant by subdomain:** `{orgId}.noriskillsets.dev` is each org's registrar. The apex `noriskillsets.dev` is the public org (`orgId === "public"`).
- **The orgId is a first-class concept:** `extractOrgId({ url })` parses a URL and returns the org; `buildOrganizationRegistryUrl({ orgId })` builds the URL from the org. Package specs are namespaced (`acme/my-skillset` → routes to `acme.noriskillsets.dev`).
- **After Firebase login**, `auth.organizations: ["acme", "foo", ...]` is populated from `/api/auth/check-access`. The CLI routes each namespaced call to the right subdomain.

This means the correct client-side answer to "which org is the token for?" is: **the user provides the orgId explicitly; the URL is derived**. Matches how the rest of the CLI already thinks about orgs. No new URL plumbing needed.

### Final decisions after iteration

- Add `apiTokenOrgId` alongside `apiToken` in config. Keep it explicit (don't re-derive from URL every time) so API-token auth cleanly coexists with a Firebase session whose `auth.organizations` is broader.
- At request time, extract the target orgId from the registry URL and match it against `apiTokenOrgId` (or env-var `NORI_ORG_ID`). **Scoping is strict:** an API token for `acme` is NEVER sent to `foo`'s subdomain — the CLI falls through to Firebase refresh-token exchange in that case.
- `--verify` dropped: adds round-trip complexity and isn't necessary — if the token is bad, the next real call will 401.
- Partial env vars (`NORI_API_TOKEN` without `NORI_ORG_ID` or vice versa) emit a stderr warning so CI operators notice misconfiguration.
- `chmod 0o600` on config writes deferred (worth doing, but applies equally to existing `refreshToken`/`password` and is better as a separate hardening PR).

---

## Testing Plan

All tests target observable behavior — what the CLI writes to config, which HTTP requests it makes, and what auth header a registry call carries — not internal control flow.

**Config schema & persistence** (`src/cli/config.test.ts`)
- Round-trip: `updateConfig({ auth: { organizationUrl, apiToken: "nori_...", apiTokenOrgId: "acme" } })` followed by `loadConfig()` returns the same `apiToken` and `apiTokenOrgId`.
- AJV's `additionalProperties: false` still rejects unknown fields on the `auth` block, but now accepts the two new fields.
- Backwards compat: a config written before this PR (no `apiToken`/`apiTokenOrgId`) still loads; `auth.refreshToken` and `auth.username` remain reachable; Firebase-based behavior unchanged.
- Backwards compat: `username` becoming nullable does NOT break the Firebase flow — a config with `username` + `refreshToken` and no `apiToken` still loads and saves.
- `validateConfig()` treats a config with only `apiToken` + `organizationUrl` (no `username`/`password`/`refreshToken`) as valid.

**`login --token` command** (`src/cli/commands/login/login.test.ts`)
- Given `--token nori_<64hex> --org acme`, writes `auth.apiToken`, `auth.apiTokenOrgId: "acme"`, `auth.organizationUrl: "https://acme.noriskillsets.dev"` to config. Clears `refreshToken`/`password`/`username`.
- Rejects `--token` without `--org` with non-zero exit and a message that `--org` is required.
- Rejects `--token` with `--org public` with non-zero exit, explaining API tokens are not supported on the public registry.
- Rejects malformed token (`--token notatoken`) with non-zero exit, pointing at the expected `nori_<64-hex>` shape. Pattern: `/^nori_[a-f0-9]{64}$/`.
- Rejects invalid orgId (e.g. `--org "Bad Org"`) via existing `isValidOrgId({ orgId })`. Non-zero exit + clear message.
- `--token` is mutually exclusive with `--email`/`--password`/`--google`. Passing two auth modes exits non-zero.
- Legal combination: plain `nori-skillsets login` (no flags) still runs the existing interactive Firebase flow unchanged.

**`logout` command** (`src/cli/commands/logout/logout.test.ts`)
- After an `apiToken`-only login, `logout` clears `auth` to null (including `apiToken` and `apiTokenOrgId`). Existing behavior extended to cover the new fields.

**Auth resolution — `AuthManager.getAuthToken`** (`src/api/base.test.ts`)
- With `config.auth.apiToken = "nori_AAA"`, `apiTokenOrgId = "acme"`, `organizationUrl = https://acme.noriskillsets.dev`: calling `apiRequest({ path: "/skillsets/foo" })` issues a request to `https://acme.noriskillsets.dev/api/skillsets/foo` with `Authorization: Bearer nori_AAA`. `exchangeRefreshToken` is never called.
- `NORI_API_TOKEN=nori_BBB` + `NORI_ORG_ID=acme` env vars take precedence over config. Request carries `Bearer nori_BBB`.
- Env vars with mismatched org (`NORI_ORG_ID=other`) DO NOT apply to requests targeting `acme.noriskillsets.dev`; config's apiToken is used (or refresh-token exchange if no config-level token).
- With `config.auth.refreshToken` set and no `apiToken`, behavior is unchanged (refresh-token exchange path).
- Config with neither apiToken nor refreshToken/password still throws the existing "not configured" error.
- **Partial env vars emit a stderr warning** (e.g. `NORI_API_TOKEN` set but `NORI_ORG_ID` missing) exactly once per process.

**Auth resolution — `getRegistryAuthToken`** (`src/api/registryAuth.test.ts`)
- Parallel to `base.ts` tests: when `registryAuth.apiToken` + `apiTokenOrgId` match the target `registryUrl`'s org, return the raw token without calling `exchangeRefreshToken`. Token is NOT cached (API tokens are long-lived; the cache would risk staleness across env changes in the same process).
- Cross-org scoping: calling `getRegistryAuthToken` with a `registryUrl` for org `foo` while config has an apiToken for `acme` falls through to the refresh-token flow — not the apiToken.

**`getRegistryAuth` (config.ts helper)** (`src/cli/config.test.ts`)
- When asked for auth for a registry URL whose orgId matches `auth.apiTokenOrgId`, the returned `RegistryAuth` carries `apiToken`. When the URL matches but no apiToken is set, returns `refreshToken` as before.

**Integration — registry search with env-var-only API token** (new test or extension to `src/cli/commands/registry-search/registrySearch.test.ts`)
- With `NORI_API_TOKEN=nori_XXX NORI_ORG_ID=acme` set and no config file on disk, an authenticated registry call routes to `https://acme.noriskillsets.dev/api/...` with the raw token as Bearer. Firebase is never initialized. This is the CI use case and it must work.

NOTE: I will write *all* tests before I add any implementation behavior.

---

## Implementation Tasks

### Task 1 — Extend config types and schema

**Files:** `src/cli/config.ts`

1. Extend `AuthCredentials` with `apiToken?: string | null` and `apiTokenOrgId?: string | null`. Change `username` from required to `username?: string | null` (still nullable for API-token-only configs).
2. Extend the nested `RawDiskConfig.auth` with the same fields. Relax `username` there as well.
3. JSON schema at `config.ts:515-569`: add `apiToken: { type: ["string", "null"] }` and `apiTokenOrgId: { type: ["string", "null"] }` under `auth.properties`. Remove `username` from `auth.required` (leave `organizationUrl` required).
4. `loadConfig` (lines 274-300): extend the "new nested format" branch to carry `apiToken`/`apiTokenOrgId`. Accept auth blocks with `apiToken` + `organizationUrl` even without `username`. Legacy flat format stays untouched (no apiToken support for legacy).
5. `saveConfig` (lines 340-442): add `apiToken?: string | null` and `apiTokenOrgId?: string | null` arguments. Write them into the nested `auth` block when provided. Do NOT write `apiToken` if empty-string.
6. `updateConfig` (lines 452-503): thread the two new fields through. Same "if 'auth' in updates use it wholesale, else preserve existing" semantics already in place — no structural change, just more fields in the pass-through.
7. `getRegistryAuth` (lines 137-178): add `apiToken` to the returned `RegistryAuth` when the lookup succeeds AND `config.auth.apiTokenOrgId` matches the derived orgId. Otherwise return it as null. Update `RegistryAuth` type to include `apiToken?: string | null` and `apiTokenOrgId?: string | null`.
8. `validateConfig` (lines 588-699): the existing logic requires `username` + `password` + `organizationUrl` when any credential is present. Loosen: a config is valid if it has `organizationUrl` AND at least one of (`username` + (`password` | `refreshToken`)) OR `apiToken`. The flat-legacy checks stay as-is.

### Task 2 — Teach the API layer about API tokens

**Files:** `src/api/base.ts`, `src/api/registryAuth.ts`

1. In `src/api/base.ts`:
   - Extend `NoriConfig` type with `apiToken?: string | null` and `apiTokenOrgId?: string | null`.
   - `ConfigManager.loadConfig()` (lines 19-67): extract `apiToken` and `apiTokenOrgId` from the nested `auth` block.
   - `ConfigManager.isConfigured()` (lines 69-74): treat `config.apiToken != null && config.organizationUrl != null` as configured, even without `username`.
   - `AuthManager.getAuthToken` (lines 81-136): before the existing `refreshToken` branch:
     - Read `NORI_API_TOKEN` and `NORI_ORG_ID` from `process.env`.
     - If exactly one of the pair is set, emit a stderr warning (once per process) and treat the pair as unset.
     - Compute `targetOrgId = extractOrgId({ url: config.organizationUrl })`.
     - If env-var pair is set AND `NORI_ORG_ID === targetOrgId`, return `NORI_API_TOKEN` directly (no caching).
     - Else if `config.apiToken` is set AND `config.apiTokenOrgId === targetOrgId`, return `config.apiToken` directly (no caching).
     - Else fall through to existing refresh-token and password branches.
   - Relax the "not configured" error to mention `apiToken` as a valid path: `"Nori is not configured. Please set refreshToken, password, or apiToken in .nori-config.json"`.
   - When `organizationUrl` is not in config but env vars are set, derive `organizationUrl` via `buildOrganizationRegistryUrl({ orgId: NORI_ORG_ID })` so env-var-only CI usage works with no config file on disk.
   - Note: `apiRequest` already attaches `Authorization: Bearer ${token}` — no transport change.
2. In `src/api/registryAuth.ts`:
   - Extend `getRegistryAuthToken` with the same precedence. Input is `RegistryAuth` (which now carries `apiToken` and `apiTokenOrgId`). Early-return the raw API token (env var wins if target matches) before falling through to the refresh-token exchange.
   - Skip `tokenCache` entirely for API-token responses.
3. Callers of `getRegistryAuth` / `getRegistryAuthToken` need no changes — the `RegistryAuth` type expansion is transparent; the `Authorization: Bearer ...` envelope is identical.

### Task 3 — Extend the `login` command

**Files:** `src/cli/commands/login/login.ts`, `src/cli/commands/noriSkillsetsCommands.ts` (command registration)

1. Add commander options to `login`:
   - `--token <value>`: raw API token.
   - `--org <orgId>`: org the token is scoped to.
2. At top of the command handler, detect `--token`:
   - Validate `--token` matches `/^nori_[a-f0-9]{64}$/`. Error out on mismatch.
   - Require `--org`. Error if missing.
   - Validate `--org` via `isValidOrgId({ orgId })`. Error on failure.
   - Reject `--org public` explicitly with a registrar-aware message.
   - Reject combination with `--email`/`--password`/`--google`.
3. Build URL via `buildOrganizationRegistryUrl({ orgId })`.
4. Write config via `updateConfig({ auth: { organizationUrl, apiToken, apiTokenOrgId: orgId, username: null, refreshToken: null, password: null, organizations: [orgId], isAdmin: null } })`.
5. `outro` message: `Logged in with API token for org '<orgId>'`.
6. In `--non-interactive` silent mode, same path but without any prompts or spinners.
7. **No `--verify` flag.** If the token is invalid, the next real registry call will 401 with the registrar's own error message — which is as clear as anything we could produce client-side.

### Task 4 — Extend `logout`

**Files:** `src/cli/commands/logout/logout.ts`

No structural change needed — `updateConfig({ auth: null })` already wipes the whole block. Task 1's tests cover the new fields being cleared.

### Task 5 — Documentation

**Files:** `src/cli/commands/login/docs.md`, any README/docs touched by the `updating-noridocs` skill.

1. Document the `--token` / `--org` flags in `login/docs.md`.
2. Document `NORI_API_TOKEN` and `NORI_ORG_ID` env vars, including partial-pair warning.
3. Note the public-registry constraint: API tokens require a private org.
4. Called from the `updating-noridocs` skill at end of development.

---

## Edge Cases

1. **Config with both `apiToken` and `refreshToken` set, hitting `apiToken`'s org subdomain:** apiToken wins (scoped match). Both stored is allowed and may occur during credential rotation. Covered by tests.
2. **Config with `apiToken` for org `acme`, request for org `foo`'s subdomain:** falls through to refresh-token. If no refresh token, fails with the existing "not configured" error. We do not silently reuse the wrong-org apiToken — server would 403 anyway, and we should fail faster client-side when the mismatch is knowable.
3. **Env vars partially set:** `NORI_API_TOKEN` without `NORI_ORG_ID` (or vice versa) is treated as unset, and a warning is logged to stderr once per process so CI operators notice the misconfiguration.
4. **`NORI_API_TOKEN` + `NORI_ORG_ID` set but no config file on disk:** derive `organizationUrl` from `NORI_ORG_ID` at request time. CI should work with zero config. `ConfigManager.isConfigured()` must account for this.
5. **Case in orgId:** server uses case-insensitive compare. Client-side, existing `isValidOrgId` requires lowercase. Keep the client strict and lowercase-only to avoid ambiguity.
6. **Trailing slash in `organizationUrl` vs derived URL during `extractOrgId` comparison:** already normalized by existing `normalizeUrl`. Unchanged.
7. **Legacy flat-format config:** does not support apiToken. If a user has a legacy config and runs `login --token`, the save path writes the new nested format (matches existing migration behavior).
8. **Running `login --token` while already logged in via Firebase:** we clear `refreshToken`/`password`/`username`. This is destructive for the user's Firebase session. Emit a note in the outro so they notice. No `--keep-session` flag — out of scope; document the behavior.

---

## Backwards Compatibility

- Existing configs without `apiToken`/`apiTokenOrgId` load and save unchanged.
- Existing `username`-required invariants relax to `organizationUrl`-required + any one credential. All current Firebase and password flows still produce valid configs under the looser schema.
- `RegistryAuth` type expansion is additive; all existing consumers compile without change.
- `saveConfig` signature grows optional params (`apiToken?`, `apiTokenOrgId?`), so callers that don't pass them are unaffected.
- AJV's `removeAdditional: true` is preserved. New fields are added explicitly to the schema.
- No changes to HTTP wire format — `Authorization: Bearer <value>` envelope is identical.
- Legacy flat-format configs continue to load; they simply don't support API tokens until migrated (writing a nested format happens automatically on the first `updateConfig` call).

---

## Deferred / Out of Scope

- CLI-side token creation, listing, or revocation. These are admin-only and live in the nori-registrar admin UI.
- `chmod 0o600` on config writes. Worth doing, but applies equally to the existing `refreshToken`/`password` fields; best addressed as a separate hardening PR.
- Multi-org API tokens in one config (one token, one org for MVP). Users needing multiple orgs can use env vars or swap configs.
- `--verify` flag on `login --token`. A real call will 401 if the token is bad — sufficient feedback.
- Special-case display in `nori-skillsets current` (which is a local skillset selector, unrelated to auth).

---

**Testing Details** All tests target behavior observable at the boundary of the unit under test: config on disk after a save, HTTP request shape after a registry call, exit code + stderr for CLI flag validation. No test inspects the implementation's internal variables. Mocks are limited to `fetch` (for registry-call tests) and `process.env` (for env-var precedence). The most important single test is the integration test proving `NORI_API_TOKEN` + `NORI_ORG_ID` alone, with zero config file, lets a registry call succeed carrying the raw token as Bearer — the concrete CI use case.

**Implementation Details**
- New config fields: `auth.apiToken`, `auth.apiTokenOrgId`. `auth.username` becomes nullable.
- New env vars: `NORI_API_TOKEN`, `NORI_ORG_ID`. Both required together. Partial pair warns on stderr once per process and is treated as unset.
- New CLI flags: `--token`, `--org` on `login`. Mutually exclusive with existing auth-method flags. No `--verify`.
- Auth resolution precedence per request: env-var pair (if target-org matches) > config apiToken (if target-org matches) > refreshToken exchange > password.
- Target org derived from URL via existing `extractOrgId`; URL derived from orgId via existing `buildOrganizationRegistryUrl`. No new URL plumbing.
- Server PR #329 reject-on-public behavior is mirrored client-side by rejecting `--org public` at login time.
- AJV schema stays strict (`additionalProperties: false`); new fields added explicitly.
- No changes to HTTP client layer — the `Authorization: Bearer ...` envelope is unchanged.
- No token cache for API tokens; existing Firebase-id-token cache remains.
- `logout` requires no code change; existing `updateConfig({ auth: null })` wipes the new fields too.

**Question** Open items resolved during the conversation — no remaining questions before implementation. Re-open if any edge case above is contested during TDD.

---
