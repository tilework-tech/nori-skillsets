# Noridoc: api

Path: @/plugin/src/api

### Overview

Client API for communicating with the Nori Profiles backend server, providing typed interfaces for artifacts, queries, conversation operations, analytics event tracking, noridocs management (with repository filtering), and prompt analysis.

### How it fits into the larger codebase

This folder contains the API client used by paid skills in @/plugin/src/installer/features/skills/config/paid-* to communicate with @/server/src/endpoints. It mirrors the API structure in @/ui/src/api/apiClient but uses Firebase Authentication with cached tokens via @/plugin/src/providers/firebase.ts instead of direct Firebase UI integration. The base.ts module handles authentication via AuthManager and request formatting via apiRequest, while artifacts.ts, query.ts, conversation.ts, analytics.ts, noridocs.ts, and promptAnalysis.ts provide typed methods for specific endpoints. The API contracts here must stay in sync with @/server/src/endpoints and @/ui/src/api/apiClient.

### Core Implementation

The base.ts module exports ConfigManager (loads credentials from `.nori-config.json` using directory resolution) and apiRequest (makes authenticated HTTP requests). ConfigManager.loadConfig() uses getInstallDirs() from @/plugin/src/utils/path.ts to locate Nori installations by walking up the directory tree from process.cwd(), supporting subdirectory execution (e.g., running from `~/project/src` when Nori is installed at `~/project`). The function returns an array of installation paths ordered from closest to furthest, using the first (closest) installation. When multiple installations exist, it logs a warning. When no installation is found, loadConfig() returns `null` rather than throwing, enabling callers to use null coalescing operators (`?.`, `??`) for cleaner error handling. JSON parse errors also return `null` for graceful degradation. The config path is resolved via getConfigPath({ installDir }) from @/plugin/src/installer/config.ts, which returns `<installDir>/.nori-config.json`. The loadConfig() function handles a race condition where trackEvent() may be called during installation before the config file is fully written - it checks for empty file content and returns {} instead of attempting JSON.parse() on empty strings. AuthManager internally handles Firebase authentication by calling signInWithEmailAndPassword with credentials from ConfigManager, caching tokens for 55 minutes, and automatically refreshing on 401 responses. All apiRequest calls include the Firebase ID token in Authorization: Bearer {token} headers.

**API Modules:**

| Module | Functions | Usage |
|--------|-----------|-------|
| artifacts.ts | `create()`, `get()` | Used by paid-memorize and paid-recall skills |
| analytics.ts | `trackEvent()` | Used by installer analytics |
| noridocs.ts | `create()`, `readByPath()`, `update()`, `list()`, `listVersions()` | Used by noridocs skills |
| conversation.ts | `summarize()` | Used by summarize hook |
| promptAnalysis.ts | `analyze()` | Used by prompt-analysis skill |
| query.ts | `search()` | Used by paid-recall skill |
| index.ts | `handshake()` | Used by CLI check command |

The artifacts.ts module defines ArtifactType enum with eight values: 'transcript', 'summary', 'recipe', 'webhook', 'memory', 'noridoc', 'premortem', 'no-type'. All Artifact types include a repository field (string) that scopes artifacts to specific repositories, extracted server-side from paths using the format @<repository>/path (e.g., @nori-watchtower/server/src/api -> repository: "nori-watchtower"). The get() method retrieves a complete artifact by ID via GET /artifact/:id, passing actor: 'claude-code' as a query parameter for analytics tracking. This enables workflows where users search for artifacts (receiving truncated snippets) and then fetch the complete artifact content using the ID from search results. The analytics.ts module exports trackEvent() which proxies analytics events to @/server/src/endpoints/analytics/trackAnalyticsEvent, forwarding to GA4 while keeping the GA4 API secret secure on the server. The noridocs.ts module provides create(), readByPath(), update(), list(), and listVersions() methods for managing documentation artifacts where sourceUrl stores the filePath and repository field scopes the noridoc. The list() method accepts an optional repository parameter for server-side filtering. The index.ts aggregates all APIs into apiClient and exports a handshake() function for testing authentication via /auth/handshake endpoint.

### Things to Know

**Authentication Architecture:** The system uses Firebase Authentication client-side. The AuthManager in base.ts uses the FirebaseProvider from @/plugin/src/providers/firebase.ts and calls signInWithEmailAndPassword to obtain Firebase ID tokens, caches them with 55-minute expiry (5 minutes before the 1-hour Firebase token expiry), and automatically refreshes tokens on 401 responses with exponential backoff retry logic (up to 3 retries by default). This matches the UI authentication flow but operates in a Node.js environment rather than browser.

**Analytics Exception:** The trackEvent() method in analytics.ts is the sole exception to the apiRequest() pattern - it makes direct fetch() calls without authentication. This is intentional: analytics must work for all users (including free-tier without organizationUrl configured). The method falls back to DEFAULT_ANALYTICS_URL when no organizationUrl is present, ensuring analytics are never silently dropped. The generateDailyReport() and generateUserReport() methods continue to use apiRequest() with authentication since they are privileged operations.

**Type Synchronization:** The ArtifactType enum in artifacts.ts must stay synchronized with @/server/src/persistence/Artifact.ts and @/ui/src/api/apiClient/artifacts.ts. All three define the same seven types (including 'noridoc') to maintain contract compatibility. The type field enables distinction between user-created memories (type: 'memory'), documentation (type: 'noridoc'), webhook-ingested data (type: 'webhook'), and system-generated artifacts (type: 'summary', 'transcript', 'recipe').

**Repository Scoping:** All Artifact types (including Noridoc) include a repository field that scopes artifacts to specific repositories. The server extracts repository from paths using regex /^@([a-z0-9-]+)\/(.+)/ - paths like "@nori-watchtower/server/src/api" are scoped to repository "nori-watchtower", while paths without repository prefix (e.g., "@/path" or "path") default to "no-repository". This enables multi-repository support where the same path can exist in different repositories without conflicts. Repository names must be lowercase alphanumeric with hyphens only.

**Actor Field:** All artifact mutations (create) and conversation operations (summarize) include actor: 'claude-code' to identify the plugin as the source. This differs from the UI which may use different actor values.

The organizationUrl in `.nori-config.json` (resolved via getInstallDirs) determines the backend server (production or local development). Paid skills are the primary consumers of this API client, importing apiClient from @/api/index.js and calling methods like apiClient.promptAnalysis.analyze() which connects to @/server/src/endpoints/promptAnalysis/handler.ts. The API client depends on @/plugin/src/providers/firebase.ts for authentication, which is a shared provider used across the plugin package. The ConfigManager follows the same directory resolution pattern as hooks and paid skills: it uses getInstallDirs({ currentDir: process.cwd() }) to locate installations, enabling correct operation when running from subdirectories of the installation root.

Created and maintained by Nori.
