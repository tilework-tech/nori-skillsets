# Noridoc: statusline/config

Path: @/src/cli/features/claude-code/statusline/config

### Overview

Contains the shell script that renders Claude Code's status line. This script is copied to `~/.claude/` at install time and executed by Claude Code on each status line refresh.

### How it fits into the larger codebase

The script is referenced by `@/src/cli/features/claude-code/statusline/loader.ts`, which copies it to `~/.claude/nori-statusline.sh` and configures `settings.json` to invoke it.

### Core Implementation

`nori-statusline.sh` receives a JSON context object on stdin from Claude Code containing session data (cost, transcript path, cwd). It uses `jq` to parse the input, then extracts and formats: git branch (via `git branch --show-current`), session cost, token usage (input, cache creation, cache read, and output tokens parsed from the transcript file), the active skillset name (from `~/.nori-config.json`), and a Nori version string. Output is rendered with ANSI color codes.

### Things to Know

The script reads `~/.nori-config.json` directly (not through the Node.js config module) to get the active skillset name and version. Token usage is computed by summing values across all messages in the transcript file using `jq` and `awk`. The script requires `jq` as an external dependency and falls back to a minimal warning message if `jq` is not available.

Created and maintained by Nori.
