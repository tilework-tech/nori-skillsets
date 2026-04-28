# Noridoc: statusline

Path: @/src/cli/features/claude-code/statusline

### Overview

- Installs a custom status line script into Claude Code that displays git branch, session cost, token usage, context length, and Nori branding
- Distinguishes between two session scopes: **user session** (opening Claude Code) where cost, tokens, and lines accumulate, and **Claude session** (`/clear` boundary) where only context resets

### How it fits into the larger codebase

- `statuslineLoader` is an `AgentLoader` included in the `claudeCodeAgentConfig.getLoaders()` pipeline in `@/src/cli/features/claude-code/agent.ts`
- Writes configuration to `~/.claude/settings.json` (home-level, via `getClaudeHomeSettingsFile()` from `@/src/cli/features/claude-code/paths.ts`)
- The shell script reads the on-disk `package.json` (resolved at install time) for the displayed version, falls back to `~/.nori-config.json`'s `.version`, and reads `~/.nori/profiles/nori-skillsets-version.json` for the registry's latest -- all at runtime, outside the Node.js config system

### Core Implementation

- `loader.ts` reads `config/nori-statusline.sh` from the build output, substitutes the `__NORI_PACKAGE_ROOT__` placeholder with the resolved package root (via `findPackageRoot` from `@/src/cli/version.ts`), writes the result to `~/.claude/nori-statusline.sh`, makes it executable, and sets `settings.statusLine` in `~/.claude/settings.json` to `type: "command"` pointing at the copied script
- The displayed Nori version is the source-of-truth for the statusline's update nag: it comes from the on-disk `package.json` so it tracks `npm install -g nori-skillsets@latest` immediately. The config-version fallback only triggers when the package.json path is missing (older script copy without substitution, or uninstalled package)
- Token and context data come from `context_window` fields in the stdin JSON that Claude Code passes to the script; tokens are accumulated by the script itself in a session file to include cached tokens and persist across `/clear`
- Cost and lines come directly from `cost.total_cost_usd`, `cost.total_lines_added`, `cost.total_lines_removed` in stdin JSON -- these are already cumulative per process, so no baseline subtraction is needed

### Things to Know

- The loader gracefully skips configuration if the source script is not found in the build output
- The shell script depends on `jq`; if missing, it displays a warning instead of the full status line
- Session tracking files in `/tmp/` store token accumulation state so that token counts include cached tokens (which are invisible in `total_input_tokens`) and persist across `/clear` boundaries
- The `package.json` placeholder substitution is the read-side of the version-sync invariant; the write-side is `syncInstalledVersion` at `@/src/cli/syncInstalledVersion.ts`, which keeps `~/.nori-config.json`'s `.version` aligned with the installed package on every `npm install`. The two together ensure the statusline never nags about an upgrade the user has already performed

Created and maintained by Nori.
