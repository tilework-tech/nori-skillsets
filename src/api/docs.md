# Noridoc: api

Path: @/src/api

### Overview

Client API for communicating with the Nori Profiles backend server, providing typed interfaces for artifacts, queries, conversation operations, analytics event tracking, noridocs management (with repository filtering), and the public Nori registrar (profile package registry).

### How it fits into the larger codebase

This folder contains the API client used by paid skills in @/src/cli/features/claude-code/profiles/config/_mixins/_paid/skills/paid-* to communicate with @/server/src/endpoints. It mirrors the API structure in @/ui/src/api/apiClient but uses Firebase Authentication with cached tokens via @/src/providers/firebase.ts instead of direct Firebase UI integration. The base.ts module handles authentication via AuthManager and request formatting via apiRequest, while artifacts.ts, query.ts, conversation.ts, analytics.ts, and noridocs.ts provide typed methods for specific endpoints. The registrar.ts module is a standalone API client for the public Nori registrar (https://registrar.tilework.tech) used by profile-related slash commands. The API contracts here must stay in sync with @/server/src/endpoints and @/ui/src/api/apiClient.

### Core Implementation

The base.ts module exports ConfigManager (loads credentials from `.nori-config.json` using directory resolution) and apiRequest (makes authenticated HTTP requests). The `NoriConfig` type contains: `username`, `password` (legacy), `refreshToken` (preferred), and `organizationUrl`. ConfigManager.loadConfig() uses getInstallDirs() from @/src/utils/path.ts to locate Nori installations by walking up the directory tree from process.cwd(), supporting subdirectory execution (e.g., running from `~/project/src` when Nori is installed at `~/project`). The function returns an array of installation paths ordered from closest to furthest, using the first (closest) installation. When multiple installations exist, it logs a warning. When no installation is found, loadConfig() returns `null` rather than throwing, enabling callers to use null coalescing operators (`?.`, `??`) for cleaner error handling. JSON parse errors also return `null` for graceful degradation. The config path is resolved via getConfigPath({ installDir }) from @/src/cli/config.ts, which returns `<installDir>/.nori-config.json`. The loadConfig() function handles a race condition where trackEvent() may be called during installation before the config file is fully written - it checks for empty file content and returns {} instead of attempting JSON.parse() on empty strings. ConfigManager.isConfigured() checks for either `refreshToken` or `password` (plus username and organizationUrl) to support both auth methods. AuthManager.getAuthToken() prefers refresh token auth (via exchangeRefreshToken from refreshToken.ts) when available, falling back to legacy password auth via Firebase SDK. All apiRequest calls include the Firebase ID token in Authorization: Bearer {token} headers.

**Refresh Token Module:** The refreshToken.ts module exchanges Firebase refresh tokens for ID tokens via REST API. `exchangeRefreshToken({ refreshToken })` sends POST to `https://securetoken.googleapis.com/v1/token` using the tilework-e18c5 Firebase project API key. ID tokens are cached in a Map keyed by refresh token, with expiry set to 5 minutes before actual expiry. The `clearRefreshTokenCache()` function is exported for testing. Note: The Firebase SDK doesn't expose refresh token exchange for stateless CLI use (it handles this internally via `user.getIdToken()`), so we use the REST API directly. Sign-in with email/password uses the Firebase SDK directly (see claude-code/config/loader.ts).

**API Modules:** Each module in this folder corresponds to a specific domain: artifacts (memory/recall), analytics (event tracking), noridocs (documentation management), conversation (summarization), query (semantic search), and registrar (package registry). The index.ts aggregates all APIs into a single apiClient export and provides a handshake() function for auth testing. Each module provides typed methods that map to @/server/src/endpoints.

**Artifacts:** The artifacts module defines an ArtifactType enum for categorizing stored content (memories, summaries, transcripts, noridocs, etc.). All Artifact types include a repository field that scopes artifacts to specific repositories - the server extracts repository from paths using the format @<repository>/path. This enables multi-repository support where the same path can exist in different repositories without conflicts. The module supports CRUD operations with actor tracking for analytics.

**Analytics:** Proxies analytics events to the server which forwards to GA4, keeping the GA4 API secret secure server-side. The trackEvent method is a special case that works without authentication (so free-tier users can be tracked).

**Noridocs:** Manages documentation artifacts with CRUD operations plus versioning support. The repository field scopes noridocs and the list method supports server-side filtering by repository.

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

**Analytics Exception:** The trackEvent() method in analytics.ts is the sole exception to the apiRequest() pattern - it makes direct fetch() calls without authentication. This is intentional: analytics must work for all users (including free-tier without organizationUrl configured). The method falls back to DEFAULT_ANALYTICS_URL when no organizationUrl is present, ensuring analytics are never silently dropped. The generateDailyReport() and generateUserReport() methods continue to use apiRequest() with authentication since they are privileged operations.

**Registrar API:** The registrar.ts module is a standalone API client for Nori package registries (npm-compatible). Unlike other API modules that use apiRequest() with Firebase authentication, the registrar uses direct fetch() calls. It supports searching packages, retrieving packument metadata, downloading tarballs, and uploading profiles. All functions support multi-registry configurations - read operations accept optional `registryUrl` and `authToken` parameters (defaulting to the public registry), while write operations require authentication. When targeting private registries, the authToken is sent as a Bearer token. The registrar API is consumed by the `nori-registry-*` intercepted slash commands and CLI commands.

**Registry Authentication:** The registryAuth.ts module handles Firebase authentication for authenticated registry operations (profile uploads). It exports `getRegistryAuthToken()` which accepts a `RegistryAuth` object (username, password, registryUrl) from the config's `registryAuths` array, authenticates with Firebase using `signInWithEmailAndPassword`, and returns a Firebase ID token. Tokens are cached per registry URL with 55-minute expiry (5 minutes before Firebase's 1-hour token expiry). Firebase app instances are also cached per registry URL to avoid reinitialization. The module uses the nori-registrar Firebase project, separate from the main Nori backend (tilework-e18c5) which is used by the base.ts authentication. The `clearRegistryAuthCache()` function is exported for testing.

**Type Synchronization:** The ArtifactType enum in artifacts.ts must stay synchronized with @/server/src/persistence/Artifact.ts and @/ui/src/api/apiClient/artifacts.ts. All three locations define the same types to maintain contract compatibility. The type field enables distinction between user-created content (memories, noridocs), system-generated content (summaries, transcripts), and external content (webhooks).

**Repository Scoping:** All Artifact types (including Noridoc) include a repository field that scopes artifacts to specific repositories. The server extracts repository from paths using regex /^@([a-z0-9-]+)\/(.+)/ - paths like "@nori-watchtower/server/src/api" are scoped to repository "nori-watchtower", while paths without repository prefix (e.g., "@/path" or "path") default to "no-repository". This enables multi-repository support where the same path can exist in different repositories without conflicts. Repository names must be lowercase alphanumeric with hyphens only.

**Actor Field:** All artifact mutations (create) and conversation operations (summarize) include actor: 'claude-code' to identify the plugin as the source. This differs from the UI which may use different actor values.

The organizationUrl in `.nori-config.json` (resolved via getInstallDirs) determines the backend server (production or local development). Paid skills are the primary consumers of this API client, importing apiClient from @/api/index.js. The API client depends on @/src/providers/firebase.ts for authentication, which is a shared provider used across the plugin package. The ConfigManager follows the same directory resolution pattern as hooks and paid skills: it uses getInstallDirs({ currentDir: process.cwd() }) to locate installations, enabling correct operation when running from subdirectories of the installation root.

Created and maintained by Nori.
