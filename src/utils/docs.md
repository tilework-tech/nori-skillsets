# Noridoc: utils

Path: @/src/utils

### Overview

Shared utility functions used across the codebase for URL manipulation, filesystem path resolution, network proxy support, API token parsing, non-interactive environment detection, error classification, and upload filename filtering. These are pure helpers with no business logic or state of their own.

### How it fits into the larger codebase

Every layer of the application imports from this module. The API layer uses `url.ts` for URL construction, `fetch.ts` for error types and proxy initialization, and `apiToken.ts` for parsing the orgId embedded in API tokens during per-request auth resolution. The CLI config system uses `path.ts` for resolving installation directories, `home.ts` for finding the user's home directory, and `apiToken.ts` when computing whether a stored API token matches a target registry org. The login command uses `apiToken.ts` to validate `--token` input. The CLI entrypoint at `@/src/cli/nori-skillsets.ts` uses `nonInteractive.ts` to set the default value of the global `--non-interactive` flag, which propagates to every subcommand via `program.opts()`. The `fetch.ts` error classes (`NetworkError`, `ApiError`, `SkillCollisionError`) are the canonical error types used throughout the codebase.

### Core Implementation

**`url.ts`** handles URL normalization (preventing double slashes), org ID validation/extraction, and URL construction for three Nori domains: `*.tilework.tech` (Watchtower), `*.nori-registry.ai` (private registries), and `*.noriskillsets.dev` (public/org registries, where `"public"` maps to the apex domain). Also provides `parseNamespacedPackage()` which parses `"org/package@version"` format specifications.

**`fetch.ts`** initializes HTTP proxy support via undici's `EnvHttpProxyAgent` (call `initializeProxySupport()` once at startup), and defines four custom error classes: `NetworkError` (connectivity issues with proxy-aware messages), `ApiError` (HTTP status errors), `SkillCollisionError` (409 conflicts during skillset upload with per-skill conflict details), and `SubagentCollisionError` (409 conflicts during skillset upload with per-subagent conflict details, structurally mirroring `SkillCollisionError`). The `formatNetworkError()` function produces user-friendly messages that vary based on error code and proxy configuration.

**`path.ts`** resolves installation directories through a priority chain: CLI flag > config value > home directory, with provenance tracking via the `ResolvedInstallDir` type (`{ path: string; source: InstallDirSource }`). The `InstallDirSource` type (`"cli" | "config" | "default"`) records where the install directory was resolved from, allowing downstream code to derive behaviors like skipping manifest operations or config persistence when the source is a transient CLI override (`"cli"`). The `resolveInstallDir()` function accepts `cliInstallDir` and `configInstallDir` as separate string parameters (rather than a full config object) and returns a `ResolvedInstallDir`. The `normalizeInstallDir()` helper handles tilde expansion, relative-to-absolute conversion, and strips trailing agent config directory segments (e.g., `.claude`) when `agentDirNames` is provided.

**`home.ts`** returns the home directory with override support: `NORI_GLOBAL_CONFIG` env var (for test isolation) > `os.homedir()` > `process.env.HOME`.

**`apiToken.ts`** parses and validates API tokens. API tokens follow the format `nori_<orgId>_<64 hex chars>`, where the orgId is embedded in the token itself so no separate orgId flag or env var is needed. Exports `API_TOKEN_PATTERN` (the canonical regex), `isValidApiToken({ token })` (shape check), and `extractOrgIdFromApiToken({ token })` (returns the orgId or `null` for malformed input). Call sites in `@/src/cli/config.ts`, `@/src/api/base.ts`, `@/src/api/registryAuth.ts`, and `@/src/cli/commands/login/login.ts` use these helpers whenever an API token needs to be matched against a target registry URL.

**`uploadFileFilter.ts`** exports `shouldExcludeFromUpload({ fileName })`, the single source of truth for filenames that the upload tarball builders must skip. The set covers the local download-metadata file (`.nori-version`), Vim swap files, editor backup files (trailing `~`), macOS `.DS_Store` and AppleDouble resource forks (`._*`), and Windows `Thumbs.db`. Both `@/src/cli/commands/registry-upload/registryUpload.ts` (`createProfileTarball`) and `@/src/cli/commands/skill-upload/skillUpload.ts` (`createSkillTarball`) consume this predicate so editor or OS junk never enters the registry's content hash and never triggers spurious "content differs" conflicts on re-upload.

**`nonInteractive.ts`** exports the pure helper `isNonInteractiveEnvironment({ stdin?, env? })`, which returns `true` when either `env.CI` is set to a truthy value (anything other than the lowercase-insensitive strings `""`, `"0"`, or `"false"`) or `stdin.isTTY` is not strictly `true` (piped stdin, cron, no controlling terminal). Both inputs default to `process.stdin` and `process.env` so the helper is trivially callable at process boot. Consumed by `@/src/cli/nori-skillsets.ts` as the default for the `-n, --non-interactive` global option and for the pre-parse argv peek that gates `checkForUpdateAndPrompt`. There is intentionally no escape hatch to force interactive mode under CI.

### Things to Know

The `NORI_GLOBAL_CONFIG` environment variable overrides the home directory globally, which affects config file location, skillset storage, and all path resolution. This is the primary mechanism for test isolation.

`SkillCollisionError` and `SubagentCollisionError` each carry structured conflict data (`conflicts` array with per-item resolution options) that the CLI upload flow uses to prompt users for resolution decisions. Both error classes have corresponding type guards (`isSkillCollisionError`, `isSubagentCollisionError`) that use both `instanceof` checks and discriminant property checks (`isSkillCollisionError` / `isSubagentCollisionError` booleans) for cross-boundary safety.

Each entry in those `conflicts` arrays (`SkillConflictInfo` / `SubagentConflictInfo`) carries an optional `fileChanges?: ReadonlyArray<FileChange> | null` field that the registrar populates on 409 upload responses. `FileChange` is `{ path, status: "added" | "modified" | "removed", isBinary, existingContent?, existingTruncated? }`, enumerating the paths that differ between the uploaded bundle and the existing latest version (metadata files like `nori.json` / `.nori-version` are excluded by the server to match the content-hash contract). `existingContent` is only populated for non-binary modified/removed entries within server-side size caps; when content is skipped or truncated, `existingTruncated` is set. Field is optional for backwards compatibility — pre-#331 registrars omit it and the CLI treats absence as "no per-file detail available". The type is mirrored in `@/src/api/registrar.ts` (`SkillConflict` / `SubagentConflict`) and is consumed by the upload flow via the `fileChangesFormat.ts` helpers in `@/src/cli/prompts/flows/`.

The API token format is deliberately self-describing: the orgId is embedded between `nori_` and the hex key, separated by underscores. Because orgIds themselves may contain hyphens, the regex uses `_` as the delimiter rather than `-`. The orgId is parsed on demand at read/request time rather than being persisted separately — this means there is no stale-scope risk when a token is replaced, and callers never need to pass the orgId alongside the token.

Created and maintained by Nori.
