# Noridoc: config

Path: @/src/cli/features/claude-code/hooks/config

### Overview

Executable hook scripts for context usage warnings, desktop notifications, and commit attribution replacement. Contains hook implementations that Claude Code invokes at lifecycle events.

### How it fits into the larger codebase

These scripts are referenced by absolute paths in ~/.claude/settings.json, configured by the parent loader at @/src/cli/features/claude-code/hooks/loader.ts. TypeScript files are compiled to JavaScript during build and executed directly via `node {script}.js` commands.

```
┌──────────────────────────────────────────┐
│  ~/.claude/settings.json                 │
│  hooks: {                                │
│    SessionStart: [...],                  │
│    Notification: [...],                  │
│    PreToolUse: [...]                     │
│  }                                       │
└───────────────┬──────────────────────────┘
                │ references
                ▼
┌──────────────────────────────────────────┐
│  hooks/config/                           │
│  ├── context-usage-warning.ts            │
│  ├── notify-hook.sh                      │
│  └── commit-author.ts                    │
└──────────────────────────────────────────┘
```

### Core Implementation

**Active hook scripts:**

| Script | Event | Purpose |
|--------|-------|---------|
| context-usage-warning.ts | SessionStart | Warns when settings.local.json files exceed 10KB (~2.5k tokens) |
| notify-hook.sh | Notification | Cross-platform desktop notifications with optional click-to-focus |
| commit-author.ts | PreToolUse | Replaces Claude attribution with Nori in git commits |

**context-usage-warning.ts** - Checks both `~/.claude/settings.local.json` and `{cwd}/.claude/settings.local.json` for excessive size. When total exceeds 10KB, outputs a systemMessage with manual cleanup instructions directing users to clear their `permissions.allow` array directly in settings.local.json.

**commit-author.ts** - Uses PreToolUse's updatedInput capability (introduced in Claude Code v2.0.10) to modify git commit commands before execution. Handles both simple `-m "message"` format and heredoc `$(cat <<'EOF' ... EOF)` format commits, preserving all original git flags.

### Things to Know

All hooks gracefully handle errors and exit with code 0 to avoid disrupting Claude Code sessions.

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
