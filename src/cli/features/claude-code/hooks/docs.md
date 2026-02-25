# Noridoc: hooks

Path: @/src/cli/features/claude-code/hooks

### Overview

The hooks system configures Claude Code lifecycle hooks that run automatically during sessions. The loader writes hook entries into `~/.claude/settings.json` and the `config/` subdirectory contains the individual hook scripts that Claude Code invokes.

### How it fits into the larger codebase

`hooksLoader` is listed in the `extraLoaders` field of `claudeCodeConfig` in @/src/cli/features/claude-code/agent.ts and runs as part of the install pipeline after shared profile loaders. It writes to `~/.claude/settings.json` (the home-level settings file, via `getClaudeHomeSettingsFile()` from `@/src/cli/features/claude-code/paths.ts`), which ensures hooks are active regardless of the current working directory.

### Core Implementation

`loader.ts` defines hook interfaces (`HookInterface`, `HookConfig`) and assembles all hooks into a single `settings.hooks` object organized by event type. It registers four hooks: `contextUsageWarningHook` (SessionStart), `updateCheckHook` (SessionStart), `notifyHook` (Notification), and `commitAuthorHook` (PreToolUse/Bash). Each hook's `install()` method returns the event binding and a `command` pointing to a script in the `config/` directory. The loader also disables Claude Code's built-in `includeCoAuthoredBy` setting since Nori provides its own attribution via the commit-author hook. `cleanupLegacyHooks.ts` removes stale hook entries from `settings.json` that reference scripts no longer shipped in the package -- it runs both as part of the loader and as a standalone npm postinstall script.

### Things to Know

`cleanupLegacyHooks` maintains a hardcoded list of removed script filenames (`REMOVED_HOOK_SCRIPTS`). When removing a hook script in the future, its filename must be added to this list. The cleanup only targets hooks whose `command` string contains `"nori-skillsets"` AND matches a known removed filename, so it will not accidentally remove user-defined hooks.

Created and maintained by Nori.
