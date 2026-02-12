# Noridoc: api

Path: @/src/api

### Overview

Client API for communicating with the Nori Profiles backend server, providing typed interfaces for analytics event tracking, the public Nori registrar (skillset package registry), and transcript upload.

### How it fits into the larger codebase

This folder contains the API client used by hook scripts and other components to communicate with @/server/src/endpoints. It mirrors the API structure in @/ui/src/api/apiClient but uses Firebase Authentication with cached tokens via @/src/providers/firebase.ts instead of direct Firebase UI integration. The base.ts module handles authentication via AuthManager and request formatting via apiRequest, while analytics.ts provides typed methods for event tracking. The registrar.ts module is a standalone API client for the public Nori registrar (https://noriskillsets.dev) used by profile-related slash commands. The transcript.ts module handles session transcript uploads. The API contracts here must stay in sync with @/server/src/endpoints and @/ui/src/api/apiClient.

### Core Implementation

The base.ts module exports ConfigManager (loads credentials from `.nori-config.json`) and apiRequest (makes authenticated HTTP requests). The `NoriConfig` type contains: `username`, `password` (legacy), `refreshToken` (preferred), and `organizationUrl`. The `apiRequest` function accepts an optional `baseUrl` parameter to override `config.organizationUrl`, enabling API calls to organization-specific endpoints (e.g., `https://myorg.noriskillsets.dev`). ConfigManager.loadConfig() first uses getInstallDirs() from @/src/utils/path.ts as a guard to check that a Nori installation exists in the directory tree, then reads config from the centralized path via `getConfigPath()` (which returns `~/.nori-config.json`). When no installation is found, loadConfig() returns `null` rather than throwing, enabling callers to use null coalescing operators (`?.`, `??`) for cleaner error handling. JSON parse errors also return `null` for graceful degradation. The loadConfig() function handles a race condition where trackEvent() may be called during installation before the config file is fully written - it checks for empty file content and returns {} instead of attempting JSON.parse() on empty strings.

**Auth Format Normalization:** ConfigManager.loadConfig() normalizes both nested and flat auth formats to return a consistent `NoriConfig` with all 4 auth fields at root level:
- **Nested format (v19+):** `{ auth: { username, password, refreshToken, organizationUrl } }` - loadConfig() extracts fields from `auth` object
- **Legacy flat format:** `{ username, password, refreshToken, organizationUrl }` at root level - returned as-is

This normalization ensures that `ConfigManager.isConfigured()` works correctly with both formats. Without this normalization, configs using the nested format would fail `isConfigured()` checks because the auth fields wouldn't be at root level where the method expects them. This affects downstream code like the stats hook that rely on `isConfigured()` to gate API calls.

ConfigManager.isConfigured() checks for either `refreshToken` or `password` (plus username and organizationUrl) to support both auth methods. AuthManager.getAuthToken() prefers refresh token auth (via exchangeRefreshToken from refreshToken.ts) when available, falling back to legacy password auth via Firebase SDK. All apiRequest calls include the Firebase ID token in Authorization: Bearer {token} headers.

**Refresh Token Module:** The refreshToken.ts module exchanges Firebase refresh tokens for ID tokens via REST API. `exchangeRefreshToken({ refreshToken })` sends POST to `https://securetoken.googleapis.com/v1/token` using the tilework-e18c5 Firebase project API key. ID tokens are cached in a Map keyed by refresh token, with expiry set to 5 minutes before actual expiry. The `clearRefreshTokenCache()` function is exported for testing. Note: The Firebase SDK doesn't expose refresh token exchange for stateless CLI use (it handles this internally via `user.getIdToken()`), so we use the REST API directly. Sign-in with email/password uses the Firebase SDK directly (see claude-code/config/loader.ts).

**API Modules:** Each module in this folder corresponds to a specific domain: analytics (event tracking), registrar (package registry), and transcript (session transcript upload). The index.ts aggregates all APIs into a single apiClient export and provides a handshake() function for auth testing. Each module provides typed methods that map to @/server/src/endpoints.

**Analytics:** Proxies analytics events to the server which forwards to GA4, keeping the GA4 API secret secure server-side. The trackEvent method works without authentication (so unauthenticated users can be tracked).

### Things to Know

**Authentication Architecture:** The system supports two authentication methods:

1. **Token-based auth (preferred):** Uses Firebase refresh tokens stored in `.nori-config.json`. The `exchangeRefreshToken()` function in refreshToken.ts exchanges refresh tokens for ID tokens via Firebase REST API (`https://securetoken.googleapis.com/v1/token`). ID tokens are cached with 5-minute buffer before expiry. During installation, the config loader (claude-code/config/loader.ts) uses the Firebase SDK's `signInWithEmailAndPassword()` to authenticate with email/password and obtain the initial refresh token, which is then stored instead of the password. This is a hard cutover: new installs use tokens immediately, passwords are never stored on disk.

2. **Legacy password-based auth (deprecated):** Existing configurations with `password` field continue to work for backward compatibility. AuthManager in base.ts uses FirebaseProvider from @/src/providers/firebase.ts and calls `signInWithEmailAndPassword` to obtain Firebase ID tokens. These configs will be migrated to tokens in future phases.

AuthManager in base.ts prefers refresh token auth via `exchangeRefreshToken()` when `config.refreshToken` is present, falling back to legacy password auth via Firebase SDK when only `config.password` is available. Both methods cache tokens with 55-minute expiry and automatically refresh on 401 responses with exponential backoff retry logic (up to 3 retries by default).

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Installation (new):                                            │
│    email/password → signInWithEmailAndPassword() → refreshToken │
│                                                                 │
│  Runtime (token-based):                                         │
│    refreshToken → exchangeRefreshToken() → idToken (cached)     │
│                                                                 │
│  Runtime (legacy):                                              │
│    password → signInWithEmailAndPassword() → idToken (cached)   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Analytics Exception:** The trackEvent() method in analytics.ts is the sole exception to the apiRequest() pattern - it makes direct fetch() calls without authentication. This is intentional: analytics must work for all users (including unauthenticated users without organizationUrl configured). The method falls back to DEFAULT_ANALYTICS_URL when no organizationUrl is present, ensuring analytics are never silently dropped.

**Registrar API:** The registrar.ts module is a standalone API client for Nori package registries (npm-compatible). Unlike other API modules that use apiRequest() with Firebase authentication, the registrar uses direct fetch() calls. It supports both skillsets and skills as first-class registry entities. Skillset methods use `/api/skillsets/` as the primary endpoint path, with a silent fallback to `/api/profiles/` on HTTP 404 for backward compatibility with older registrar instances that have not been updated. The `fetchWithFallback()` helper handles this: it tries the primary URL, and if the response is 404, computes a fallback URL via `buildFallbackUrl()` (which replaces `/api/skillsets/` with `/api/profiles/` and `/skillset` sub-resource with `/profile`) and retries. Non-404 errors are not retried. Skill methods (`/api/skills/*`) do not use this fallback mechanism and call fetch() directly. All functions support multi-registry configurations - read operations accept optional `registryUrl` and `authToken` parameters (defaulting to the public registry), while write operations require authentication. When targeting private registries, the authToken is sent as a Bearer token. The registrar API is consumed by the `nori-registry-*` intercepted slash commands and CLI commands.

**Skillset API Methods:**
- `searchPackages()` - Search for skillsets in the registrar
- `getPackument()` - Get skillset metadata including versions
- `downloadTarball()` - Download skillset tarball (resolves latest if no version specified)
- `uploadSkillset()` - Upload skillset to registrar (requires auth). Accepts optional `resolutionStrategy` parameter for resolving skill conflicts. When the server returns a 409 response with a `conflicts` array (indicating inline skills that conflict with existing registry skills), throws `SkillCollisionError` from @/utils/fetch.ts containing conflict details and available resolution actions

**Skill API Methods:**
- `searchSkills()` - Search for skills in the registrar
- `getSkillPackument()` - Get skill metadata including versions
- `downloadSkillTarball()` - Download skill tarball (resolves latest if no version specified)
- `uploadSkill()` - Upload skill to registrar (requires auth)

**Registry Authentication:** The registryAuth.ts module handles Firebase authentication for authenticated registry operations (profile uploads, org registry search). It exports `getRegistryAuthToken()` which accepts a `RegistryAuth` object (username, refreshToken, registryUrl) and exchanges the refresh token for a Firebase ID token via `exchangeRefreshToken()` from refreshToken.ts. Tokens are cached per registry URL with 55-minute expiry (5 minutes before Firebase's 1-hour token expiry). The module uses the unified Nori authentication (same refresh token as Watchtower) - the `config.auth` credentials are reused for registry operations. The `clearRegistryAuthCache()` function is exported for testing.

**Transcript API:** The transcript.ts module uploads session transcripts to the user's private registry. It exports `transcriptApi.upload({ sessionId, messages, title?, orgId? })` which posts to `/transcripts` endpoint using the standard apiRequest pattern with Firebase authentication. The `TranscriptMessage` type is a flexible structure containing optional fields: `type`, `sessionId`, `message` (with role/content), `summary`, and arbitrary additional fields via index signature. When `orgId` is provided, the upload targets that specific organization's registry URL (e.g., `orgId: "myorg"` -> `https://myorg.noriskillsets.dev`); otherwise it uses the default `config.organizationUrl`. The upload response returns `{ id, title, sessionId, createdAt }`. This API is consumed by the watch daemon's uploader module (@/src/cli/commands/watch/uploader.ts) for automatic transcript persistence.

The organizationUrl in `~/.nori-config.json` determines the backend server (production or local development). Hook scripts and other components consume this API client via @/api/index.js. The API client depends on @/src/providers/firebase.ts for authentication, which is a shared provider used across the plugin package. The ConfigManager uses getInstallDirs({ currentDir: process.cwd() }) as a guard to verify a Nori installation exists, then reads from the centralized config at `~/.nori-config.json` via `getConfigPath()`.

Created and maintained by Nori.
