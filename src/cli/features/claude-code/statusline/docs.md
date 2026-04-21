# Noridoc: statusline

Path: @/src/cli/features/claude-code/statusline

### Overview

- Installs a custom status line script into Claude Code that displays git branch, session cost, token usage, context length, and Nori branding
- Handles session reset: token/context counters reset automatically on `/clear`; cost/lines counters reset via session-id tracking

### How it fits into the larger codebase

- `statuslineLoader` is an `AgentLoader` included in the `claudeCodeAgentConfig.getLoaders()` pipeline in `@/src/cli/features/claude-code/agent.ts`
- Writes configuration to `~/.claude/settings.json` (home-level, via `getClaudeHomeSettingsFile()` from `@/src/cli/features/claude-code/paths.ts`)
- The shell script reads `~/.nori-config.json` and `~/.nori/profiles/nori-skillsets-version.json` at runtime (outside the Node.js config system)

### Core Implementation

- `loader.ts` copies `config/nori-statusline.sh` to `~/.claude/nori-statusline.sh`, makes it executable, and sets `settings.statusLine` in `~/.claude/settings.json` to `type: "command"` pointing at the copied script
- Token and context data come from structured `context_window` fields in the stdin JSON that Claude Code passes to the script (not from transcript file parsing)
- Cost and lines data come from `cost` fields in stdin JSON, with session-relative deltas tracked via `/tmp/nori-statusline-session-<cwd-hash>` files

### Things to Know

- The loader gracefully skips configuration if the source script is not found in the build output
- The shell script depends on `jq`; if missing, it displays a warning instead of the full status line
- Session tracking files in `/tmp/` allow cost/lines to reset on `/clear` without requiring Claude Code to reset those cumulative fields itself

Created and maintained by Nori.
