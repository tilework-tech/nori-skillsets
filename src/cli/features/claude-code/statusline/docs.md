# Noridoc: statusline

Path: @/src/cli/features/claude-code/statusline

### Overview

The statusline feature installs a custom status line script into Claude Code that displays git branch, session cost, token usage, and Nori branding at the bottom of the terminal during Claude Code sessions.

### How it fits into the larger codebase

`statuslineLoader` is an `AgentLoader` included in the `claudeCodeAgentConfig.getLoaders()` pipeline in `@/src/cli/features/claude-code/agent.ts`. It writes configuration to `~/.claude/settings.json` (home-level, via `getClaudeHomeSettingsFile()` from `@/src/cli/features/claude-code/paths.ts`).

### Core Implementation

`loader.ts` copies the shell script from `config/nori-statusline.sh` to `~/.claude/nori-statusline.sh`, makes it executable, and sets `settings.statusLine` in `~/.claude/settings.json` to point to the copied script with `type: "command"` and `padding: 0`. Claude Code then executes this script to render the status line.

### Things to Know

The loader gracefully skips configuration if the source script is not found in the build output. The status line script (`config/nori-statusline.sh`) depends on `jq` being installed -- if `jq` is missing, it displays a warning message instead of the full status line.

Created and maintained by Nori.
