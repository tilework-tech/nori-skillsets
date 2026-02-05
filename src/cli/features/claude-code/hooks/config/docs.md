# Noridoc: config

Path: @/src/cli/features/claude-code/hooks/config

### Overview

Executable hook scripts for conversation summarization, session statistics, desktop notifications, context usage warnings, transcript completion markers, and commit attribution replacement. Contains hook implementations that Claude Code invokes at lifecycle events.

### How it fits into the larger codebase

These scripts are referenced by absolute paths in ~/.claude/settings.json, configured by the parent loader at @/src/cli/features/claude-code/hooks/loader.ts. TypeScript files are compiled to JavaScript during build and executed directly via `node {script}.js` commands.

```
┌──────────────────────────────────────────┐
│  ~/.claude/settings.json                 │
│  hooks: {                                │
│    SessionEnd: [...],                    │
│    SessionStart: [...],                  │
│    Notification: [...],                  │
│    PreToolUse: [...]                     │
│  }                                       │
└───────────────┬──────────────────────────┘
                │ references
                ▼
┌──────────────────────────────────────────┐
│  hooks/config/                           │
│  ├── statistics-notification.ts          │
│  ├── statistics.ts                       │
│  ├── context-usage-warning.ts            │
│  ├── notify-hook.sh                      │
│  ├── commit-author.ts                    │
│  ├── summarize-notification.ts           │
│  ├── summarize.ts                        │
│  ├── transcript-done-marker.ts           │
│  └── format.ts (shared utility)          │
└──────────────────────────────────────────┘
```

### Core Implementation

**Active hook scripts:**

| Script | Event | Purpose |
|--------|-------|---------|
| statistics-notification.ts | SessionEnd | Displays "Calculating Nori statistics..." message before statistics calculation |
| statistics.ts | SessionEnd | Calculates and displays ASCII table with message counts, tool usage, skills, subagents |
| context-usage-warning.ts | SessionStart | Warns when settings.local.json files exceed 10KB (~2.5k tokens) |
| notify-hook.sh | Notification | Cross-platform desktop notifications with optional click-to-focus |
| commit-author.ts | PreToolUse | Replaces Claude attribution with Nori in git commits |
| summarize-notification.ts | SessionEnd | Displays notification before backend memorization |
| summarize.ts | SessionEnd | Sends conversation summaries to Nori backend |
| transcript-done-marker.ts | SessionEnd | Writes marker file for transcript upload triggering |

**format.ts** - Shared formatting utilities:
- `formatSuccess()` / `formatError()`: Apply green/red coloring with per-word wrapping
- `calculatePrefixLines()`: Calculates how many terminal lines Claude Code's hook failure prefix occupies
- `formatWithLineClear()`: Prepends ANSI escape codes to clear the Claude Code prefix before displaying colored output

**context-usage-warning.ts** - Checks both `~/.claude/settings.local.json` and `{cwd}/.claude/settings.local.json` for excessive size. When total exceeds 10KB, outputs a systemMessage with manual cleanup instructions directing users to clear their `permissions.allow` array directly in settings.local.json.

**commit-author.ts** - Uses PreToolUse's updatedInput capability (introduced in Claude Code v2.0.10) to modify git commit commands before execution. Handles both simple `-m "message"` format and heredoc `$(cat <<'EOF' ... EOF)` format commits, preserving all original git flags.

### Things to Know

**Exit codes and stderr output:** The statistics and notification hooks exit with code 2 to trigger Claude Code's failure display mechanism (which shows stderr to users). They use ANSI escape codes via `formatWithLineClear()` to clear the "SessionEnd hook [path] failed:" prefix before displaying their actual output.

**isEmptyTranscript() validation:** The summarize.ts script uses strict content validation - parses newline-delimited JSON transcript, filters for user message types, and checks if message content contains non-whitespace. Only transcripts with at least one substantive user message are sent to backend.

**Transcript handling:** summarize.ts and statistics.ts read the transcript via the `transcript_path` field from stdin JSON passed by Claude Code.

### Optional Dependencies for Click-to-Focus Notifications

The notify-hook.sh script sends desktop notifications when Claude needs attention. By default, notifications work on all platforms but may not support click-to-focus behavior without optional dependencies.

**Linux (X11)**

For clickable notifications that return focus to your terminal, install:

**Ubuntu/Debian:**

```bash
sudo apt-get install libnotify-bin wmctrl xdotool
```

**Fedora:**

```bash
sudo dnf install libnotify wmctrl xdotool
```

**Arch:**

```bash
sudo pacman -S libnotify wmctrl xdotool
```

**Note:** Click-to-focus is not supported on Wayland yet. Basic notifications will still work, but clicking them won't restore terminal focus. The script auto-detects Wayland via $XDG_SESSION_TYPE and gracefully degrades to basic notifications.

**macOS**

For clickable notifications that return focus to your terminal, install terminal-notifier via Homebrew:

```bash
brew install terminal-notifier
```

Without terminal-notifier, notifications will appear via osascript but won't be clickable (clicking opens Script Editor instead).

**Windows**

Windows notifications use built-in PowerShell commands and don't require additional dependencies. Click-to-focus is not currently implemented for Windows.

Created and maintained by Nori.
