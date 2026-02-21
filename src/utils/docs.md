# Noridoc: utils

Path: @/src/utils

### Overview

Shared utility functions used across the codebase for URL manipulation, filesystem path resolution, network proxy support, and error classification. These are pure helpers with no business logic or state of their own.

### How it fits into the larger codebase

Every layer of the application imports from this module. The API layer uses `url.ts` for URL construction and `fetch.ts` for error types and proxy initialization. The CLI config system uses `path.ts` for resolving installation directories and `home.ts` for finding the user's home directory. The `fetch.ts` error classes (`NetworkError`, `ApiError`, `SkillCollisionError`) are the canonical error types used throughout the codebase.

### Core Implementation

**`url.ts`** handles URL normalization (preventing double slashes), org ID validation/extraction, and URL construction for three Nori domains: `*.tilework.tech` (Watchtower), `*.nori-registry.ai` (private registries), and `*.noriskillsets.dev` (public/org registries, where `"public"` maps to the apex domain). Also provides `parseNamespacedPackage()` which parses `"org/package@version"` format specifications.

**`fetch.ts`** initializes HTTP proxy support via undici's `EnvHttpProxyAgent` (call `initializeProxySupport()` once at startup), and defines three custom error classes: `NetworkError` (connectivity issues with proxy-aware messages), `ApiError` (HTTP status errors), and `SkillCollisionError` (409 conflicts during skillset upload with per-skill conflict details). The `formatNetworkError()` function produces user-friendly messages that vary based on error code and proxy configuration.

**`path.ts`** resolves installation directories through a priority chain: CLI flag > config value > home directory. Handles tilde expansion, relative-to-absolute conversion, and strips trailing agent config directory segments (e.g., `.claude`) when `agentDirNames` is provided.

**`home.ts`** returns the home directory with override support: `NORI_GLOBAL_CONFIG` env var (for test isolation) > `os.homedir()` > `process.env.HOME`.

### Things to Know

The `NORI_GLOBAL_CONFIG` environment variable overrides the home directory globally, which affects config file location, skillset storage, and all path resolution. This is the primary mechanism for test isolation.

`SkillCollisionError` carries structured conflict data (`conflicts` array with per-skill resolution options) that the CLI upload flow uses to prompt users for resolution decisions.

Created and maintained by Nori.
