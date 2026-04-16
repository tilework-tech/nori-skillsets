# Noridoc: api

Path: @/src/api

### Overview

The API module contains HTTP clients for all external service communication: the skillset/skill registry (registrar), analytics event tracking, transcript uploads, and Firebase authentication token management. All authenticated requests flow through a centralized `apiRequest` function with retry logic and token refresh.

### How it fits into the larger codebase

CLI commands in `@/src/cli/commands/` call into this module for registry operations (search, download, upload) and transcript uploads. Authentication depends on config loaded from `@/src/cli/config.ts` (via `ConfigManager.loadConfig()`) and the Firebase provider at `@/src/providers/firebase.ts`. URL construction uses helpers from `@/src/utils/url.ts`, and network error formatting comes from `@/src/utils/fetch.ts`.

### Core Implementation

**`base.ts`** provides `ConfigManager` (reads `~/.nori-config.json` synchronously), `AuthManager` (caches Firebase ID tokens with 55-minute expiry), and `apiRequest()` -- a generic authenticated fetch wrapper with exponential backoff retries and automatic 401 token refresh. This is the foundation for `transcript.ts`. `AuthManager` is exported so tests can call `AuthManager.reset()` to clear cached tokens between cases. The `readApiTokenEnv()` helper reads `NORI_API_TOKEN`, validates its shape via `isValidApiToken` from `@/src/utils/apiToken.ts`, parses out the orgId, and returns `{ token, orgId }` or `null`. Malformed or empty values return `null` silently (no warning is emitted).

**Auth resolution precedence** (per request, evaluated top-down in `AuthManager.getAuthToken` and mirrored in `getRegistryAuthToken` from `registryAuth.ts`):

```
1. NORI_API_TOKEN env var      (only when embedded orgId === extractOrgId(targetUrl))
2. config.auth.apiToken        (only when embedded orgId === extractOrgId(targetUrl))
3. config.auth.refreshToken    (exchanged for Firebase ID token, cached 55 min)
4. config.auth.password        (legacy Firebase signInWithEmailAndPassword)
```

API tokens have format `nori_<orgId>_<64 hex chars>`. The orgId is extracted from the token itself via `extractOrgIdFromApiToken` on every resolution (no separate orgId field is stored or passed alongside). Tokens are sent raw as `Authorization: Bearer nori_<orgId>_<hex>` and are NEVER cached (they are long-lived, and caching risks staleness across env changes within one process). The wire format is distinguishable from Firebase ID tokens by the `nori_` prefix. Scoping is strict: a token scoped to `acme` is never forwarded to a request targeting `foo.noriskillsets.dev`; the resolver falls through to the refresh-token path instead. The server rejects API tokens on the public apex, so the CLI also refuses any token whose embedded org is `public` at login time (see `@/src/cli/commands/login/docs.md`).

**Env var** (`NORI_API_TOKEN`): a single env var encodes both the token and the scope. When set and valid AND no config file exists on disk, `apiRequest` derives `effectiveBaseUrl` via `buildOrganizationRegistryUrl({ orgId: envApi.orgId })` so CI can authenticate with zero config. An unset or malformed `NORI_API_TOKEN` is silently treated as absent. `ConfigManager.isConfigured()` returns `true` for either an env-var-only setup or a config with `apiToken + organizationUrl` (no `username` required).

**`registrar.ts`** is the registry API client (`registrarApi`) with methods for skillsets (`/api/skillsets/`), skills (`/api/skills/`), and subagents (`/api/subagents/`). Skillset endpoints use `fetchWithFallback` which silently retries on `/api/profiles/` if the primary path returns 404, for backward compatibility with older registries. Read operations (search, packument, download) are optionally authenticated; write operations (upload) require a bearer token. The `UploadSkillsetRequest` type includes `inlineSkills`, `inlineSubagents`, `resolutionStrategy`, and `subagentResolutionStrategy` fields; `uploadSkillset` sends all as JSON-serialized form fields when present. The `UploadSkillsetResponse` carries `extractedSubagents` alongside `extractedSkills`. Subagent API methods (`getSubagentPackument`, `downloadSubagentTarball`) follow the same pattern as skill methods but target `/api/subagents/`.

**Upload 409 collision wire shape:** The registrar serializes BOTH `SkillCollisionError` and `SubagentCollisionError` into a 409 body with a single shared `conflicts` key (the server never emits a separate `subagentConflicts` field — the web UI in `nori-registrar/ui/src/features/publish/PublishForm.vue` has always discriminated by item shape, and the CLI now matches that contract). `uploadSkillset` inspects the items in `conflicts`: if any item has a `skillId`, it throws `SkillCollisionError` (skill wins for mixed payloads, mirroring the web UI's `some` predicate to keep existing skill-resolution flows working); otherwise it throws `SubagentCollisionError` with the items cast to `Array<SubagentConflict>`. Both errors carry `requiresVersions` through from the response. This replaces an earlier client-only assumption of a `subagentConflicts` response field that the server never emitted — the symptom of that drift was that subagent conflicts were misread as skill conflicts and `sks upload` would fail silently with a bare "Upload failed".

**`refreshToken.ts`** exchanges Firebase refresh tokens for ID tokens using the Firebase REST API directly (not the SDK), because the SDK requires an active user session. It maintains its own in-memory cache with a 5-minute safety buffer before expiry.

**`registryAuth.ts`** provides per-registry-URL token caching for Firebase ID tokens and precedence-checks for API tokens. `getRegistryAuthToken` evaluates env-var API tokens (scoped match against the orgId parsed from the token), then config API tokens (scoped match against the orgId parsed from the token), then the cached Firebase token, then performs a refresh-token exchange. API tokens short-circuit before the cache is consulted and are never written back to the cache.

**`analytics.ts`** fires analytics events to the organization URL (or a default). Failures are silently swallowed to avoid interrupting user flow.

**`transcript.ts`** uploads session transcripts via `apiRequest`, optionally routing to organization-specific subdomains. The upload payload conditionally includes `projectName` and `skillsetName` -- both are nullable and only included when non-null.

### Things to Know

There are three layers of token caching, all exclusively for Firebase tokens: `refreshToken.ts` caches the raw token exchange result, `registryAuth.ts` caches per-registry tokens, and `AuthManager` in `base.ts` caches the token used by `apiRequest`. All use time-based expiry (55 minutes for Firebase tokens, with varying safety buffers). API tokens bypass every cache layer and are returned raw on each call.

Target org is derived from the request URL at resolution time via `extractOrgId` from `@/src/utils/url.ts`, and the token's own org is derived via `extractOrgIdFromApiToken` from `@/src/utils/apiToken.ts`. Cross-org API-token use is never silently promoted — if the two orgIds do not match, the resolver falls through to the next precedence level (which mirrors the server's 403 behavior for cross-org tokens, failing faster client-side when the mismatch is knowable).

`ConfigManager.loadConfig()` in `base.ts` handles an expected race condition during fresh installation where the config file may be empty because analytics fires before the file is fully written. Empty files return `{}` rather than throwing.

Created and maintained by Nori.
