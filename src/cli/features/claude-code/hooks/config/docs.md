# Noridoc: hooks/config

Path: @/src/cli/features/claude-code/hooks/config

### Overview

Contains the individual hook scripts that Claude Code invokes at various lifecycle events. Each script reads JSON from stdin (provided by Claude Code), performs its logic, and optionally outputs a JSON response to stdout.

### How it fits into the larger codebase

These scripts are referenced by absolute path in `@/src/cli/features/claude-code/hooks/loader.ts`, which writes the paths into `~/.claude/settings.json`. Claude Code executes them as child processes at the configured lifecycle events.

### Core Implementation

`commit-author.ts` is a `PreToolUse` hook for the `Bash` tool. It intercepts `git commit` commands and replaces Claude Code's co-author attribution with Nori attribution. It handles both heredoc-format and simple `-m` flag commit messages. The hook outputs a JSON response with `permissionDecision: "allow"` and an `updatedInput` containing the modified command.

`update-check.ts` is a `SessionStart` hook that checks whether a newer version of `nori-skillsets` is available. It reads `~/.nori-config.json` for the current version and autoupdate preference, consults the version cache from `@/src/cli/updates/`, and outputs a `systemMessage` prompting the user to update if a newer version exists.

`context-usage-warning.ts` is a `SessionStart` hook that checks the combined size of `settings.local.json` files (home-level and project-level). If the total exceeds 10KB, it outputs a `systemMessage` warning about excessive context token consumption from bloated permissions arrays.

A `notify-hook.sh` shell script (not shown as TypeScript) sends desktop notifications when Claude Code needs input.

### Things to Know

All hooks exit with code 0 even on error to avoid disrupting Claude Code sessions. The commit-author hook protects escaped template variables (backtick-wrapped `{{var}}`) from substitution. The update-check hook respects the `autoupdate: "disabled"` config setting and triggers background cache refreshes when the version cache is stale.

Created and maintained by Nori.
