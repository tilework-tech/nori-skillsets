# Noridoc: hooks

Path: @/src/cli/features/claude-code/hooks

### Overview

The hooks system configures Claude Code lifecycle hooks that run automatically during sessions. The loader writes hook entries into `~/.claude/settings.json` and the `config/` subdirectory contains the individual hook scripts that Claude Code invokes.

### How it fits into the larger codebase

`hooksLoader` is an `AgentLoader` included in the `claudeCodeAgentConfig.getLoaders()` pipeline in `@/src/cli/features/claude-code/agent.ts`. It writes to `~/.claude/settings.json` (the home-level settings file, via `getClaudeHomeSettingsFile()` from `@/src/cli/features/claude-code/paths.ts`), which ensures hooks are active regardless of the current working directory.

### Core Implementation

`loader.ts` defines hook interfaces (`HookInterface`, `HookConfig`) and assembles all hooks into a single `settings.hooks` object organized by event type. It registers four hooks: `contextUsageWarningHook` (SessionStart), `updateCheckHook` (SessionStart), `notifyHook` (Notification), and `commitAuthorHook` (PreToolUse/Bash). Each hook's `install()` method returns the event binding and a `command` pointing to a script in the `config/` directory. The loader also disables Claude Code's built-in `includeCoAuthoredBy` setting since Nori provides its own attribution via the commit-author hook.

This directory also hosts the package's npm `postinstall` lifecycle scripts, declared in `@/package.json`'s `scripts.postinstall` and chained sequentially:

- `cleanupLegacyHooks.ts` removes stale hook entries from `~/.claude/settings.json` that reference scripts no longer shipped in the package. It runs both as part of the hooks loader and as a standalone postinstall script.
- `syncInstalledVersion.ts` writes the on-disk `package.json` version into `~/.nori-config.json`'s `.version` field so the cached config tracks `npm install -g nori-skillsets@latest` upgrades. Without this, the config's `.version` only changes on `nori init` / `nori install`, which would leave consumers (e.g., the statusline update nag, see `@/src/cli/features/claude-code/statusline/docs.md`) reading a stale version.

Both postinstall scripts are best-effort: they swallow errors so a broken postinstall never aborts an `npm install`.

### Things to Know

`cleanupLegacyHooks` maintains a hardcoded list of removed script filenames (`REMOVED_HOOK_SCRIPTS`). When removing a hook script in the future, its filename must be added to this list. The cleanup only targets hooks whose `command` string contains `"nori-skillsets"` AND matches a known removed filename, so it will not accidentally remove user-defined hooks.

`syncInstalledVersion` no-ops silently if the config file is missing, malformed JSON, or if the package version cannot be resolved (i.e., `getCurrentPackageVersion` from `@/src/cli/version.ts` returns null). It does not create a config file; the file must already exist (from a prior `nori init`/`install`) for the sync to take effect. Field preservation is handled by `updateConfig` from `@/src/cli/config.ts`, which read-merge-writes so unrelated fields (auth, activeSkillset, etc.) stay intact.

Created and maintained by Nori.
