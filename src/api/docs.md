# Noridoc: api

Path: @/src/api

### Overview

The API module contains HTTP clients for all external service communication: the skillset/skill registry (registrar), analytics event tracking, transcript uploads, and Firebase authentication token management. All authenticated requests flow through a centralized `apiRequest` function with retry logic and token refresh.

### How it fits into the larger codebase

CLI commands in `@/src/cli/commands/` call into this module for registry operations (search, download, upload) and transcript uploads. Authentication depends on config loaded from `@/src/cli/config.ts` (via `ConfigManager.loadConfig()`) and the Firebase provider at `@/src/providers/firebase.ts`. URL construction uses helpers from `@/src/utils/url.ts`, and network error formatting comes from `@/src/utils/fetch.ts`.

### Core Implementation

**`base.ts`** provides `ConfigManager` (reads `~/.nori-config.json` synchronously), `AuthManager` (caches Firebase ID tokens with 55-minute expiry), and `apiRequest()` -- a generic authenticated fetch wrapper with exponential backoff retries and automatic 401 token refresh. This is the foundation for `transcript.ts`.

**`registrar.ts`** is the registry API client (`registrarApi`) with methods for both skillsets (`/api/skillsets/`) and skills (`/api/skills/`). Skillset endpoints use `fetchWithFallback` which silently retries on `/api/profiles/` if the primary path returns 404, for backward compatibility with older registries. Read operations (search, packument, download) are optionally authenticated; write operations (upload) require a bearer token. Skill collision detection on upload surfaces `SkillCollisionError` with per-skill conflict resolution options.

**`refreshToken.ts`** exchanges Firebase refresh tokens for ID tokens using the Firebase REST API directly (not the SDK), because the SDK requires an active user session. It maintains its own in-memory cache with a 5-minute safety buffer before expiry.

**`registryAuth.ts`** provides per-registry-URL token caching for private registry authentication, using the same refresh token exchange mechanism.

**`analytics.ts`** fires analytics events to the organization URL (or a default). Failures are silently swallowed to avoid interrupting user flow.

**`transcript.ts`** uploads session transcripts via `apiRequest`, optionally routing to organization-specific subdomains. The upload payload conditionally includes `projectName` and `skillsetName` -- both are nullable and only included when non-null.

### Things to Know

There are three layers of token caching: `refreshToken.ts` caches the raw token exchange result, `registryAuth.ts` caches per-registry tokens, and `AuthManager` in `base.ts` caches the token used by `apiRequest`. All use time-based expiry (55 minutes for Firebase tokens, with varying safety buffers).

`ConfigManager.loadConfig()` in `base.ts` handles an expected race condition during fresh installation where the config file may be empty because analytics fires before the file is fully written. Empty files return `{}` rather than throwing.

Created and maintained by Nori.
