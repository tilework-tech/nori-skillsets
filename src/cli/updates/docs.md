# Noridoc: updates

Path: @/src/cli/updates

### Overview

The updates module implements auto-update checking for the `nori-skillsets` CLI. It uses a stale-while-revalidate cache pattern: a background fetch refreshes the cached latest version from npm, while the current process reads from the cache to avoid blocking on network requests.

### How it fits into the larger codebase

`checkForUpdateAndPrompt` is called from the CLI entry point (`@/cli/nori-skillsets.ts`) before command parsing. It reads the autoupdate config setting from `@/cli/config`, the install state from `@/cli/installTracking` (for package manager detection), and manages its own version cache file at `~/.nori/profiles/nori-skillsets-version.json`.

### Core Implementation

The update check pipeline flows through three layers:

```
checkForUpdateAndPrompt (orchestrator)
  -> refreshVersionCache (background, fire-and-forget)
  -> getAvailableUpdate (reads cache, compares versions)
  -> showUpdatePrompt (interactive or non-interactive display)
  -> execFileSync (runs the actual update command if chosen)
```

`versionCache.ts` manages a JSON cache file with `latest_version`, `last_checked_at`, and `dismissed_version` fields. The cache is considered stale after 12 hours. `dismissVersion` persists the user's "skip until next version" choice.

`npmRegistryCheck.ts` fetches from `https://registry.npmjs.org/nori-skillsets/latest` with a 5-second timeout. `getAvailableUpdate` filters out prerelease versions, development builds (`0.0.0`), and dismissed versions. It also treats `-next` prerelease tags as equivalent to their base version to avoid prompting users on nightly builds to "downgrade."

`updatePrompt.ts` resolves the correct global install command for npm, bun, yarn, or pnpm. In interactive mode it shows a `@clack/prompts` `select()` menu with three choices (update now / skip / skip until next version); in non-interactive mode it emits a `log.warn()` notice and returns "skip."

### Things to Know

The entire module is wrapped in silent error handling -- update checking never disrupts CLI operation. Early exits skip the check when autoupdate is disabled, silent mode is active, or the version is `0.0.0` (development).

The `-next` prerelease handling in `getAvailableUpdate` is noteworthy: semver considers `0.6.3-next.1` less than `0.6.3`, but the code treats `-next` as "at least the base version" by stripping the prerelease tag before comparison. This prevents users on nightly builds from being prompted to install an older stable release.

When the user chooses to update, the module runs `execFileSync` with `stdio: "inherit"` to update in-place, then calls `process.exit(0)` to force a restart.

Created and maintained by Nori.
