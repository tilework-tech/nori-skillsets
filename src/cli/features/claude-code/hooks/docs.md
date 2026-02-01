# Noridoc: hooks

Path: @/src/cli/features/claude-code/hooks

### Overview

Feature loader that configures Claude Code hooks by writing hook configurations directly into ~/.claude/settings.json. Manages hooks for: session statistics, desktop notifications with click-to-focus support, auto-updates, nested installation warnings, context usage warnings (alerts when accumulated permissions consume excessive tokens), worktree disk usage warnings (alerts when git worktrees consume excessive disk space), onboarding wizard welcome messages (for first-time users), user notifications for transcript saving that respect sendSessionTranscript configuration, slash command interception via UserPromptSubmit (registry-based system in intercepted-slashcommands/), and commit-author replacement via PreToolUse interception of Bash git commit commands. Also configures git settings to disable Claude Code's built-in co-author byline in favor of Nori attribution.

### How it fits into the larger codebase

This feature loader (loader.ts) is registered with @/src/cli/features/claude-code/loaderRegistry.ts and executed by @/src/cli/commands/install/install.ts during installation. Unlike other feature loaders that copy files, the hooks loader writes hook configurations into ~/.claude/settings.json using Claude Code's native hooks system. Hook scripts from @/src/cli/features/claude-code/hooks/config are referenced via absolute paths in the settings.json configuration.

### Core Implementation

The loader.ts defines HookInterface objects (statisticsHook, statisticsNotificationHook, autoupdateHook, nestedInstallWarningHook, contextUsageWarningHook, worktreeCleanupHook, onboardingWizardWelcomeHook, notifyHook, slashCommandInterceptHook, commitAuthorHook), each providing an install() function that returns hook configurations. A single `configureHooks()` function installs all hooks across SessionEnd, SessionStart, Notification, UserPromptSubmit, and PreToolUse events, and also sets `settings.includeCoAuthoredBy = false` to disable Claude Code's built-in git co-author attribution. All hooks are installed for all users regardless of authentication status. The loader reads existing settings.json, merges the hooks configuration and git settings into the settings object, and writes it back. The removeHooks() function removes both the hooks configuration and the includeCoAuthoredBy setting during uninstall, cleaning up empty git objects to avoid polluting settings.json with empty structures. The validate() function ensures all expected hooks are present and properly configured, checking for both the event types and the specific commands in each hook, as well as verifying that includeCoAuthoredBy is set to false.

### Things to Know

The statisticsNotificationHook must be registered before statisticsHook to ensure users see the notification synchronously before the async statistics calculation begins. Both notification hooks and statistics.ts output to stderr via `console.error()` with `formatWithLineClear()` from intercepted-slashcommands/format.ts. These hooks exit with code 2 to trigger Claude Code's failure display mechanism, then use ANSI escape codes to clear the "SessionEnd hook [path] failed:" prefix that Claude Code would otherwise display (see @/src/cli/features/claude-code/hooks/config/docs.md for details on the line-clearing mechanism). All hooks gracefully handle errors and exit with code 0 to avoid disrupting Claude Code sessions. The validate() function performs deep inspection of settings.json to verify not just that hooks exist, but that specific scripts (statistics-notification.js, statistics.js, autoupdate.js, notify-hook.sh, nested-install-warning.js, worktree-cleanup.js, onboarding-wizard-welcome.js) are referenced in the correct events, and also validates that includeCoAuthoredBy is set to false.

The includeCoAuthoredBy setting works in conjunction with the commitAuthorHook PreToolUse hook to replace Claude Code's attribution with Nori's. The hooks loader sets `includeCoAuthoredBy = false` to disable Claude Code's built-in "Co-Authored-By: Claude" attribution, while the commitAuthorHook intercepts Bash tool calls for git commit commands and programmatically replaces any Claude attribution with "Co-Authored-By: Nori <contact@tilework.tech>" and a generated-with message. The hook uses PreToolUse's updatedInput capability (introduced in Claude Code v2.0.10) to modify git commit commands before execution.

The nestedInstallWarningHook runs on SessionStart with the 'startup' matcher and checks for Nori installations in ancestor directories using findAncestorInstallations() from @/src/utils/path.ts. If ancestor installations are detected, it outputs a systemMessage warning the user about potential duplicate or conflicting configurations.

The worktreeCleanupHook runs on SessionStart with the 'startup' matcher and warns users when git worktrees are consuming excessive disk space. The hook checks two thresholds: (1) total worktree size exceeds 50GB, (2) system disk space is below 10% remaining.

The onboardingWizardWelcomeHook runs on SessionStart with the 'startup' matcher and displays a welcome message when the user's current profile is `onboarding-wizard-questionnaire`.

The slashCommandInterceptHook intercepts slash commands at the UserPromptSubmit event to enable instant execution without LLM inference. The hook uses a registry pattern (see @/src/cli/features/claude-code/hooks/config/intercepted-slashcommands/) where each command implements the InterceptedSlashCommand interface with matchers (regex patterns) and a run function.

The notifyHook (notify-hook.sh) logs to the consolidated log file at `/tmp/nori.log`.

The autoupdate hook logs all installation activity to `/tmp/nori.log`. It creates an install-in-progress marker file at ~/.nori-install-in-progress containing the version being installed, which is checked by the statusline to display error messages if installation fails.

Desktop notifications support click-to-focus functionality on Linux X11 and macOS when optional dependencies are installed.

Created and maintained by Nori.
