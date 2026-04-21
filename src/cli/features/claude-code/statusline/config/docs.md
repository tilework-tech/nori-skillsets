# Noridoc: statusline/config

Path: @/src/cli/features/claude-code/statusline/config

### Overview

- Contains the shell script (`nori-statusline.sh`) that renders Claude Code's status line
- Copied to `~/.claude/` at install time and executed by Claude Code on each status line refresh
- Displays git branch, session cost, token usage, context length, lines changed, skillset name, and Nori branding

### How it fits into the larger codebase

- Referenced by `@/src/cli/features/claude-code/statusline/loader.ts`, which copies it to `~/.claude/nori-statusline.sh` and configures `settings.json` to invoke it
- Reads `~/.nori-config.json` directly (not through the Node.js config module) to get the active skillset name and version
- Reads `~/.nori/profiles/nori-skillsets-version.json` to check for available updates

### Core Implementation

- Receives a JSON object on stdin from Claude Code containing `cwd`, `session_id`, `cost`, `context_window`, and `transcript_path`
- **Tokens:** Uses `context_window.total_input_tokens` and `context_window.total_output_tokens` from stdin JSON. These fields reset automatically when `/clear` creates a new session.
- **Context length:** Sums `context_window.current_usage.input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` from stdin JSON
- **Cost and lines changed:** Uses session-relative tracking via `session_id`. When the session ID changes (e.g., after `/clear`), the script stores the current cumulative cost/lines as a baseline in `/tmp/nori-statusline-session-<cwd-hash>`. Display values are deltas from that baseline, resetting to zero on new sessions.
- Outputs three lines with ANSI color codes: metrics line, branding line, and a status tip (promotional, update notification, or install-failure warning)

### Things to Know

- Session state files are stored at `/tmp/nori-statusline-session-<md5-of-cwd>` and persist across script invocations. The file format is four lines: session_id, baseline_cost, baseline_lines_added, baseline_lines_removed.
- Requires `jq` as an external dependency; falls back to a minimal warning message if `jq` is not available
- Version comparison for update notifications uses `node -e` for cross-platform semver comparison (macOS lacks `sort -V`)
- The script strips `-next.*` suffixes from versions before comparing, so pre-release versions are treated as their base release

Created and maintained by Nori.
