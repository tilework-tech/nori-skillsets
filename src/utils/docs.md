# Noridoc: utils

Path: @/src/utils

### Overview

Shared utility functions for the plugin package, containing URL utilities for normalization and service URL construction, path utilities for installation directory resolution, and network/API error handling utilities including custom error classes for network failures, API errors, and skill collision conflicts.

### How it fits into the larger codebase

This folder provides utilities used throughout the plugin package at multiple system boundaries. The normalizeUrl function is used in @/src/api/base.ts to construct API request URLs (combining organizationUrl from config with endpoint paths), in @/src/cli/config.ts to normalize user-provided organizationUrl values before saving to `.nori-config.json`, and is used by the API client throughout the codebase. The identical implementation exists in @/ui/src/utils/url.ts for the web UI, maintaining consistent URL handling across all client packages.

The fetch.ts module provides network error handling utilities used by @/src/api/registrar.ts for registry API operations. It exports custom error classes (`NetworkError`, `ApiError`, `SkillCollisionError`) and the `isSkillCollisionError` type guard that enable callers to distinguish between different failure modes. The `SkillCollisionError` is specifically used when uploading skillsets with inline skills that conflict with existing registry skills - it contains conflict details and available resolution actions, enabling the CLI layer (@/src/cli/features/claude-code/hooks/config/intercepted-slashcommands/nori-registry-upload.ts) to implement auto-resolution for unchanged skills.

The path.ts module provides installation directory resolution used across CLI commands. The `resolveInstallDir` function implements a priority chain: CLI `--install-dir` flag > `config.installDir` > home directory fallback. The `normalizeInstallDir` function converts user-provided paths (tilde-prefixed, relative, or absolute) to absolute paths, defaulting to `os.homedir()` if no path is provided. Config is always read from and written to `~/.nori-config.json` via @/src/cli/config.ts (zero-arg `getConfigPath()`, `loadConfig()`, and `saveConfig()`).

### Core Implementation

The url.ts module exports URL normalization and construction functions:

**normalizeUrl:** Accepts { baseUrl: string, path?: string | null } and returns a normalized URL. The function strips all trailing slashes from baseUrl using replace(/\/+$/, ''), handles optional path by ensuring it starts with exactly one leading slash, and concatenates them to prevent double slashes.

**isValidOrgId:** Accepts { orgId: string } and returns a boolean. Validates that the org ID is lowercase alphanumeric with optional hyphens, not starting or ending with a hyphen. Uses the regex pattern `/^[a-z0-9]+(-[a-z0-9]+)*$/`.

**buildWatchtowerUrl:** Accepts { orgId: string } and returns the Watchtower URL as `https://{orgId}.tilework.tech`.

**buildRegistryUrl:** Accepts { orgId: string } and returns the Registry URL as `https://{orgId}.nori-registry.ai`.

**buildOrganizationRegistryUrl:** Accepts { orgId: string } and returns the organization-specific registry URL for noriskillsets.dev. The "public" org maps to the apex domain `https://noriskillsets.dev`, while other orgs map to subdomains like `https://{orgId}.noriskillsets.dev`. Used by registry-upload, registry-download, and skill-download commands to determine the target registry based on package namespace.

**parseNamespacedPackage:** Accepts { packageSpec: string } and returns `{ orgId: string, packageName: string, version: string | null }` or null if invalid. Parses package specifications in formats:
- `package-name` -> `{ orgId: "public", packageName: "package-name", version: null }`
- `package-name@1.0.0` -> `{ orgId: "public", packageName: "package-name", version: "1.0.0" }`
- `org/package-name` -> `{ orgId: "org", packageName: "package-name", version: null }`
- `org/package-name@1.0.0` -> `{ orgId: "org", packageName: "package-name", version: "1.0.0" }`

Non-namespaced packages default to the "public" organization. Used by registry-upload, registry-download, and skill-download commands to extract org, package name, and version from user-provided package specifications. The orgId is then passed to buildOrganizationRegistryUrl to derive the correct registry URL.

These URL construction functions are used by the install command (@/src/cli/commands/install/install.ts) and various registry commands to convert user-provided org IDs into full service URLs. The stored config format remains unchanged (full URLs), so this is purely a UX improvement at the user input layer.

The path.ts module exports `normalizeInstallDir` and `resolveInstallDir` for installation directory resolution. The module imports `Config` from @/src/cli/config.ts and `getHomeDir` from @/src/utils/home.ts.

**normalizeInstallDir:** Accepts { installDir?: string | null } and returns the BASE installation directory (without `.claude` suffix), handling tilde expansion (`~/` becomes home directory), relative path resolution, and path normalization. If no installDir is provided, it defaults to `getHomeDir()`. If a path ending with `.claude` is provided, it strips the suffix and returns the parent directory. The `installDir` only determines where the `.claude/` subdirectory is created (Claude Code configuration). Config and profiles are centralized at `~/.nori-config.json` and `~/.nori/profiles/` regardless of `installDir`.

The `installDir` parameter is still used by Claude-specific path functions (`getClaudeDir`, `getClaudeMdFile`, `getClaudeSettingsFile`, etc.) for the `.claude/` directory, which is project-relative. The `.nori` directory is centralized: `getNoriDir()` is zero-arg and returns `~/.nori`, and `getNoriProfilesDir()` is zero-arg and returns `~/.nori/profiles`. Config is always at `~/.nori-config.json` via the zero-arg `getConfigPath()` and `loadConfig()` functions in @/src/cli/config.ts.

**resolveInstallDir:** Accepts { cliInstallDir?: string | null, config?: Config | null } and returns the resolved absolute installation directory path. Implements a three-tier priority chain:

| Priority | Source | Condition |
|---|---|---|
| 1 (highest) | CLI `--install-dir` flag | `cliInstallDir` is non-null and non-empty |
| 2 | `config.installDir` | Config has a persisted `installDir` value |
| 3 (fallback) | Home directory | Neither of the above is set |

Each non-fallback tier passes through `normalizeInstallDir` for path normalization. The fallback returns `getHomeDir()` directly. This function is the standard way all commands resolve the installation directory, replacing the previous pattern of walking the filesystem to discover installations.

### Things to Know

URL normalization happens at two critical points: (1) when users provide organizationUrl during installation (installer/config.ts normalizes before saving to `.nori-config.json` to ensure consistent storage format), and (2) when making API requests (api/base.ts combines the stored organizationUrl with endpoint paths like /api/analytics/track). This prevents URL construction bugs from user input variations like "https://example.com/" vs "https://example.com" or paths with/without leading slashes. The utility is used throughout the codebase for consistent URL handling. The implementation is duplicated across @/src/utils/url.ts and @/ui/src/utils/url.ts rather than shared because the packages have different module systems (Node.js vs browser) and build processes.

**Single installation directory model:** The concept of "multiple installations" no longer exists. There is always exactly one resolved installation directory, determined by the `resolveInstallDir` priority chain. Commands no longer walk the filesystem to discover installations.

**Centralized `.nori` directory:** The `getNoriDir()` and `getNoriProfilesDir()` functions are zero-arg and always resolve to `~/.nori` and `~/.nori/profiles` respectively via `os.homedir()`. The Claude-specific path functions (`getClaudeDir`, etc.) still take an `installDir` parameter for the `.claude/` directory.

Created and maintained by Nori.
