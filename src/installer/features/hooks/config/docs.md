# Noridoc: config

Path: @/plugin/src/installer/features/hooks/config

### Overview

Executable hook scripts for conversation summarization, desktop notifications, package auto-updates, nested installation warnings, and instant profile switching. Contains six hook implementations that Claude Code invokes at lifecycle events: summarize.ts (memorizes conversations to backend), summarize-notification.ts (displays sync user notification), autoupdate.ts (checks and installs package updates), nested-install-warning.ts (warns about ancestor installations), notify-hook.sh (cross-platform desktop notifications), and quick-switch.ts (intercepts profile switch commands for instant execution).

### How it fits into the larger codebase

This folder contains the actual hook implementations referenced by @/plugin/src/installer/features/hooks/loader.ts in ~/.claude/settings.json. The hooks are executed by Claude Code at specific lifecycle events. The summarize.ts hook calls @/plugin/src/api/conversation.ts to create conversation artifacts in the backend. The autoupdate.ts hook uses npm to check for and install new versions of the nori-ai package. The nested-install-warning.ts hook uses findAncestorInstallations() from @/plugin/src/utils/path.ts to detect conflicting Nori installations in parent directories. The notify-hook.sh script provides cross-platform desktop notification support, summarize-notification.ts displays a quick message to users when transcripts are being saved, and quick-switch.ts intercepts `/switch-nori-profile` commands at the UserPromptSubmit event to switch profiles without LLM inference overhead.

### Core Implementation

TypeScript files are compiled to JavaScript during build and executed directly via `node {script}.js` commands configured in settings.json. No shell script wrappers exist anymore (previously removed in favor of direct TypeScript execution).

**summarize.ts**: Accepts SessionEnd or PreCompact as first argument. Reads conversation data from process.argv[3] or stdin. Before processing, checks two conditions: (1) ConfigManager.isConfigured() ensures ~/nori-config.json exists, (2) loadDiskConfig() reads sendSessionTranscript field and skips if set to 'disabled', displaying "Session Transcript disabled. Use /nori-toggle-session-transcripts to reenable" message. If enabled, parses conversation data JSON to extract transcript_path, reads the full transcript file, and filters empty transcripts using isEmptyTranscript() before calling apiClient.conversation.summarize(). Empty transcript detection checks for user messages with actual content - transcripts containing only metadata (file-history-snapshot, summaries) or only assistant messages are skipped with debug logging. Outputs `{async: true}` on startup to run asynchronously without blocking session end.

**summarize-notification.ts**: Synchronous hook that checks sendSessionTranscript configuration before outputting user feedback. Calls loadDiskConfig() to check if sendSessionTranscript is 'disabled'. When disabled, outputs `{systemMessage: "Session transcripts disabled. Use /nori-toggle-session-transcripts to enable"}`. When enabled (or missing for backward compatibility), outputs `{systemMessage: "Saving transcript to nori...\n\n"}`. Provides immediate user feedback about transcript state while summarize.ts runs asynchronously in background. Exports main as async function to support config loading, with silent error handling to prevent session crashes.

**autoupdate.ts**: Tracks session starts via Google Analytics and checks for package updates. On every run, loads disk config to determine install_type ('paid' if auth credentials exist, 'free' otherwise), then tracks `nori_session_started` event with metadata: installed_version (from build-time injection), update_available (boolean), and install_type. The tracking call is asynchronous with silent failure to never disrupt session startup. Then compares installed version against latest npm registry version using `npm view nori-ai version`. When update available, spawns detached background process running `npx nori-ai@{version} install --non-interactive` to install update and re-run installer preserving user config. Uses openSync() to obtain a file descriptor for redirecting spawn stdio to ~/.nori-notifications.log - detached spawns require file descriptors (integers), not stream objects. Registers error event listener on child process to log spawn failures and exit event listener to close file descriptor and prevent resource leaks. Outputs systemMessage with version upgrade notification.

**nested-install-warning.ts**: SessionStart hook that checks for Nori installations in ancestor directories. Loads disk config to get the installation directory (defaulting to cwd if not set), normalizes it using normalizeInstallDir(), then calls findAncestorInstallations() to detect parent directories with Nori installations. If ancestor installations are found, builds a systemMessage warning about Claude Code's recursive CLAUDE.md loading behavior and provides uninstall commands for each detected installation. The hook uses logToClaudeSession() helper to output JSON with systemMessage field for Claude Code to display. All errors are caught and logged silently with exit code 0 to prevent disrupting session startup.

**notify-hook.sh**: Shell script (only remaining shell script in config/) that reads JSON notification data from stdin. Derives install directory from script location (going up two directories from `.claude/hooks/`) to locate the log file at `{install_dir}/.nori-notifications.log`. Parses message field using python3/jq/node/sed fallbacks for portability. Platform detection via `uname -s` determines notification method: Linux uses notify-send with click-to-focus actions (X11 only, requires wmctrl/xdotool), macOS tries terminal-notifier with click-to-focus then falls back to osascript (not clickable), Windows tries BurntToast PowerShell module then Windows Forms then msg.exe. Captures terminal window ID on Linux X11 using xdotool before sending notification, then restores focus when user clicks. macOS click-to-focus auto-detects terminal app bundle ID from $TERM_PROGRAM environment variable. Gracefully degrades to basic notifications on Wayland or when optional dependencies are missing.

**quick-switch.ts**: UserPromptSubmit hook that intercepts `/switch-nori-profile` commands for instant profile switching. Reads stdin JSON containing prompt, cwd, session_id, and other Claude Code context. Matches prompt against `/switch-nori-profile` patterns (with or without profile name). Uses cwd to locate profiles at `{cwd}/.claude/profiles/`, validating each profile has a CLAUDE.md file. When invoked without a profile name, returns `{decision: "block", reason: "Available profiles: ..."}` to directly display available profiles without LLM. When invoked with a profile name, writes profile selection to `{cwd}/.nori-config.json`, preserves existing auth config, and returns `{hookSpecificOutput: {additionalContext: "..."}}` with context for Claude to describe the profile and instruct user to restart. The config file is always in the cwd - there is no HOME directory fallback, as the installation directory is determined by where Claude Code is running. Profile descriptions are read from `profile.json` if available. All errors (missing profiles, invalid profile name) return block decisions with user-facing messages. Exits with code 0 on all paths to avoid disrupting Claude Code sessions.

### Things to Know

Hook execution is controlled by @/plugin/src/installer/features/hooks/loader.ts configuration: paid installations install all six hooks (summarize, summarize-notification, autoupdate, nested-install-warning, notify, quick-switch), free installations get autoupdate, nested-install-warning, notify, and quick-switch. The summarize-notification hook must be registered before summarize hook in loader.ts to ensure synchronous user notification appears before async background summarization.

All TypeScript hooks use JSON.stringify() to output structured responses: summarize.ts outputs `{async: true}` to run non-blocking, while autoupdate.ts, nested-install-warning.ts, and summarize-notification.ts output `{systemMessage: "..."}` to inject messages into Claude sessions. Error handling is strictly non-fatal - all hooks catch errors, log via error() function, and exit with code 0 to prevent disrupting Claude Code sessions. Both summarize.ts and summarize-notification.ts check sendSessionTranscript configuration: (1) summarize.ts performs ConfigManager.isConfigured() to ensure ~/nori-config.json exists, then loadDiskConfig() to check sendSessionTranscript field, exiting early with a systemMessage when disabled; (2) summarize-notification.ts calls loadDiskConfig() to check the same field and displays appropriate user feedback ("Saving transcript..." when enabled, "Session transcripts disabled..." when disabled). This ensures consistent user messaging about transcript state across both hooks.

The isEmptyTranscript() function (exported for testing in summarize.test.ts) uses strict content validation: parses newline-delimited JSON transcript, filters for user message types, and checks if message content (string or array with text) contains non-whitespace. Only transcripts with at least one substantive user message are sent to backend. This prevents unnecessary API calls for metadata-only sessions (file-history-snapshot, auto-compaction summaries, assistant-only exchanges).

The autoupdate.ts spawn mechanism is a critical system boundary - it must be non-blocking to allow Claude Code session to start immediately. The detached spawn pattern with unref() allows the parent process to exit while the update continues in background. IMPORTANT: Node.js spawn() with detached: true requires file descriptors (integers) for stdio, NOT stream objects. Using createWriteStream() causes silent spawn failures because streams cannot be used as stdio in detached mode. The openSync(path, 'a') pattern is required to get a file descriptor for appending to the log file. The error event listener catches spawn failures (e.g., npx not in PATH) and logs to ~/.nori-notifications.log since the parent process exits immediately. The exit event listener closes the file descriptor to prevent resource leaks - without it, file descriptors accumulate across session starts.

Historical note: This directory previously contained abilities-context.ts and skills-context.ts hooks for SessionStart ability/skill discovery. Both were removed - abilities-context.ts was renamed to skills-context.ts during superpowers integration (#104), then skills-context.ts was deleted when skill discovery moved to hardcoded CLAUDE.md generation at install time (#120). Shell script wrappers (autoupdate.sh, summarize.sh, summarize-notification.sh) were also removed in favor of direct TypeScript execution via node commands.

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
