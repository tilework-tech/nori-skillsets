# Noridoc: statusline/config

Path: @/src/cli/features/claude-code/statusline/config

### Overview

- Contains the shell script (`nori-statusline.sh`) that renders Claude Code's status line
- Copied to `~/.claude/` at install time and executed by Claude Code on each status line refresh
- Displays git branch, session cost, token usage, context length, lines changed, skillset name, and Nori branding

### How it fits into the larger codebase

- Referenced by `@/src/cli/features/claude-code/statusline/loader.ts`, which writes a substituted copy to `~/.claude/nori-statusline.sh` and configures `settings.json` to invoke it
- Reads the installed `package.json` (path baked in via the `NORI_PACKAGE_ROOT` placeholder substituted at install time) to get the displayed Nori version. Falls back to `~/.nori-config.json`'s `.version` when the package.json path is unavailable
- Reads `~/.nori-config.json` directly (not through the Node.js config module) for the active skillset name
- Reads `~/.nori/profiles/nori-skillsets-version.json` to check for available updates

### Core Implementation

- Receives a JSON object on stdin from Claude Code containing `cwd`, `session_id`, `cost`, `context_window`, and `transcript_path`
- **Tokens:** Computed from `context_window.current_usage` fields (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`) to include cached tokens. The script accumulates its own running total in a session file because Claude's `total_input_tokens` excludes cached tokens (the system prompt alone is ~27k cached tokens).
- **Context length:** Sums `context_window.current_usage.input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` -- reflects the most recent message's context size and naturally resets on `/clear`
- **Cost and lines changed:** Displayed directly from `cost.total_cost_usd`, `cost.total_lines_added`, `cost.total_lines_removed`. These are already cumulative per Claude Code process, so they persist across `/clear` without any script-side tracking.
- Outputs three lines with ANSI color codes: metrics line, branding line, and a status tip (promotional, update notification, or install-failure warning)

### Things to Know

- Session state files are stored at `/tmp/nori-statusline-session-<md5-of-cwd>` and persist across script invocations. The file format is four lines: `session_id`, `prev_raw_total` (non-cached token total from last invocation), `accumulated_tokens` (running total including cached), `cost` (for process restart detection).
- Process restart is detected by a cost decrease heuristic (cost going down means a new Claude Code process started). On restart, accumulated tokens reset to zero.
- `/clear` is detected via `session_id` change; this resets the raw token tracking baseline so new API calls are correctly detected, but does not reset the accumulated token count.
- Requires `jq` as an external dependency; falls back to a minimal warning message if `jq` is not available
- Version comparison for update notifications uses `node -e` for cross-platform semver comparison (macOS lacks `sort -V`); `-next.*` suffixes are stripped before comparing so pre-release versions are treated as their base release
- The `NORI_PACKAGE_ROOT` line in the source script holds a literal `__NORI_PACKAGE_ROOT__` placeholder. The loader rewrites it before copying to `~/.claude/`, so the live script knows where the installed package lives. If the rewrite did not happen (older copy, missing build output), the script transparently falls back to the config's version so behavior degrades gracefully rather than rendering an empty version string

Created and maintained by Nori.
