# Noridoc: hooks

Path: @/src/cli/features/claude-code/hooks

### Overview

Feature loader that configures Claude Code hooks by writing hook configurations directly into ~/.claude/settings.json. Manages hooks for: context usage warnings, desktop notifications, and commit-author replacement. Also configures git settings to disable Claude Code's built-in co-author byline in favor of Nori attribution.

### How it fits into the larger codebase

This feature loader (loader.ts) is registered with @/src/cli/features/claude-code/loaderRegistry.ts and executed by @/src/cli/commands/install/install.ts during installation. Unlike other feature loaders that copy files, the hooks loader writes hook configurations into ~/.claude/settings.json using Claude Code's native hooks system. Hook scripts from @/src/cli/features/claude-code/hooks/config are referenced via absolute paths in the settings.json configuration.

### Core Implementation

The loader.ts defines HookInterface objects (contextUsageWarningHook, notifyHook, commitAuthorHook), each providing an install() function that returns hook configurations. The loader installs hooks across SessionStart, Notification, and PreToolUse events, and also sets `settings.includeCoAuthoredBy = false` to disable Claude Code's built-in git co-author attribution. The loader reads existing settings.json, merges the hooks configuration and git settings into the settings object, and writes it back. The removeHooks() function removes both the hooks configuration and the includeCoAuthoredBy setting during uninstall. The validate() function ensures expected hooks are present and properly configured, checking for both the event types and the specific commands in each hook, as well as verifying that includeCoAuthoredBy is set to false. Each hook points to a compiled JavaScript file in @/src/cli/features/claude-code/hooks/config using Node.js to execute them.

### Things to Know

**Active hooks:**
| Hook | Event | Matcher | Purpose |
|------|-------|---------|---------|
| contextUsageWarningHook | SessionStart | `startup` | Warns when settings.local.json files are consuming excessive tokens |
| notifyHook | Notification | `` | Sends cross-platform desktop notifications |
| commitAuthorHook | PreToolUse | `Bash` | Replaces Claude attribution with Nori in git commits |

The `includeCoAuthoredBy = false` setting disables Claude Code's built-in git co-author attribution, while the commitAuthorHook intercepts Bash tool calls for git commit commands and programmatically replaces any Claude attribution with "Co-Authored-By: Nori <contact@tilework.tech>" and "Generated with [Nori](https://nori.ai)".

The settings.json structure uses event matchers (`startup` for session start, empty string for Notification events, `Bash` for PreToolUse) to control when hooks fire. All hooks gracefully handle errors and exit with code 0 to avoid disrupting Claude Code sessions.

Desktop notifications support click-to-focus functionality on Linux X11 and macOS when optional dependencies are installed (see @/src/cli/features/claude-code/hooks/config/docs.md for installation instructions).

The notifyHook (notify-hook.sh) logs to the consolidated log file at `/tmp/nori.log` for easier debugging.

Created and maintained by Nori.
