# Noridoc: updates

Path: @/src/cli/updates

### Overview

Auto-update check system that uses a stale-while-revalidate pattern to notify users when a newer version of nori-skillsets is available on npm. Provides a CLI prompt at startup and exposes cached version data for consumption by hooks and the statusline.

### How it fits into the larger codebase

- The orchestrator (`checkForUpdateAndPrompt`) is called from @/src/cli/nori-skillsets.ts before `program.parse()`, making it the first user-facing interaction on every CLI invocation.
- Version data is persisted to `~/.nori/profiles/nori-skillsets-version.json`, which is read (no network) by the SessionStart hook at @/src/cli/features/claude-code/hooks/config/update-check.ts and the statusline script at @/src/cli/features/claude-code/statusline/config/nori-statusline.sh.
- Respects the `autoupdate` field from `.nori-config.json` (managed by @/src/cli/config.ts). When set to `"disabled"`, all update checking is skipped.
- Respects `--silent` and `--non-interactive` CLI flags from @/src/cli/nori-skillsets.ts. Silent mode skips entirely; non-interactive mode prints a one-liner to stderr instead of the interactive prompt.
- Package manager detection reads the persisted install state from @/src/cli/installTracking.ts (`readInstallState()`), falling back to `npm_config_user_agent` env var, defaulting to npm.

```
CLI startup (nori-skillsets.ts)
    |
    +-- checkForUpdateAndPrompt()           # orchestrator
         |
         +-- refreshVersionCache()          # fire-and-forget, writes cache if stale
         |       |
         |       +-- isCacheStale()         # 20h TTL
         |       +-- fetchLatestVersionFromNpm()  # 5s timeout
         |       +-- writeVersionCache()
         |
         +-- getAvailableUpdate()           # reads cache, semver compare
         +-- showUpdatePrompt()             # interactive 3-option prompt
         +-- dismissVersion()               # writes dismissed_version to cache
```

### Core Implementation

- **versionCache.ts** - Read/write/staleness for the JSON cache at `~/.nori/profiles/nori-skillsets-version.json`. The `VersionCache` type stores `latest_version`, `last_checked_at` (ISO timestamp), and optional `dismissed_version`. Cache is considered stale after 20 hours (configurable via `maxAgeHours`). `dismissVersion()` writes the version string into `dismissed_version` so subsequent checks skip that version.
- **npmRegistryCheck.ts** - `fetchLatestVersionFromNpm()` hits `https://registry.npmjs.org/nori-skillsets/latest` with a 5-second AbortController timeout. `refreshVersionCache()` only fetches when the cache is stale, preserving `dismissed_version` across refreshes. `getAvailableUpdate()` reads the cache, filters out prerelease and `0.0.0` dev builds, compares with semver, and checks the dismissed list.
- **updatePrompt.ts** - `formatUpdateMessage()` renders an ANSI-colored box with three options: Update now, Skip, Skip until next version. `getUpdateCommand()` maps the detected package manager (npm/bun/yarn/pnpm) to the correct global install command. `showUpdatePrompt()` renders the interactive prompt via readline or falls back to a stderr one-liner in non-interactive mode.
- **checkForUpdate.ts** - Main orchestrator. Loads the `autoupdate` setting from `.nori-config.json` (checks `~/.claude/.nori-config.json` then `cwd/.nori-config.json`). Fires `refreshVersionCache()` as fire-and-forget (no await). Calls `getAvailableUpdate()` against the cached data. On "update" choice, runs `execFileSync` with the resolved package manager command and exits with code 0 on success. On "dismiss" choice, calls `dismissVersion()`. All failures are caught and logged as non-fatal.

### Things to Know

**Stale-while-revalidate:** The background npm fetch (`refreshVersionCache`) is fired as `void refreshVersionCache()` -- it runs concurrently and does not block the prompt. The prompt always uses whatever is in the cache at the moment. This means the first CLI run after install will never show a prompt (cache doesn't exist yet); the fetch populates the cache for the next run.

**Three user choices:** "Update now" runs the package manager synchronously via `execFileSync` with `stdio: "inherit"`, then calls `process.exit(0)` so the user must re-run their command. "Skip" does nothing. "Skip until next version" writes `dismissed_version` to the cache, suppressing the prompt until a newer version appears.

**Version filtering:** Development builds (`0.0.0`), prerelease versions, and dismissed versions are all filtered out by `getAvailableUpdate()`. Invalid semver strings cause a silent null return.

Created and maintained by Nori.
