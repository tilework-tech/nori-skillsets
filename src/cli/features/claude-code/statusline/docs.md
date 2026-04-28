# Noridoc: statusline

Path: @/src/cli/features/claude-code/statusline

### Overview

- Installs a custom status line script into Claude Code that displays git branch, session cost, token usage, context length, and Nori branding
- Distinguishes between two session scopes: **user session** (opening Claude Code) where cost, tokens, and lines accumulate, and **Claude session** (`/clear` boundary) where only context resets

### How it fits into the larger codebase

- `statuslineLoader` is an `AgentLoader` included in the `claudeCodeAgentConfig.getLoaders()` pipeline in `@/src/cli/features/claude-code/agent.ts`
- Writes configuration to `~/.claude/settings.json` (home-level, via `getClaudeHomeSettingsFile()` from `@/src/cli/features/claude-code/paths.ts`)
- The shell script reads `~/.nori-config.json` (for the active skillset) and `~/.nori/profiles/nori-skillsets-version.json` (for the cached latest-known version) at runtime, outside the Node.js config system. The running CLI version is resolved by spawning `sks --version` rather than being read from the config.

### Core Implementation

- `loader.ts` copies `config/nori-statusline.sh` to `~/.claude/nori-statusline.sh`, makes it executable, and sets `settings.statusLine` in `~/.claude/settings.json` to `type: "command"` pointing at the copied script
- Token and context data come from `context_window` fields in the stdin JSON that Claude Code passes to the script; tokens are accumulated by the script itself in a session file to include cached tokens and persist across `/clear`
- Cost and lines come directly from `cost.total_cost_usd`, `cost.total_lines_added`, `cost.total_lines_removed` in stdin JSON -- these are already cumulative per process, so no baseline subtraction is needed

### Things to Know

- The loader gracefully skips configuration if the source script is not found in the build output
- The shell script depends on `jq`; if missing, it displays a warning instead of the full status line
- Session tracking files in `/tmp/` store token accumulation state so that token counts include cached tokens (which are invisible in `total_input_tokens`) and persist across `/clear` boundaries

Created and maintained by Nori.
