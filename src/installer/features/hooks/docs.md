# Noridoc: hooks

Path: @/plugin/src/installer/features/hooks

### Overview

Feature loader that configures Claude Code hooks by writing hook configurations directly into ~/.claude/settings.json. Manages four types of hooks: conversation summarization (paid only), desktop notifications with click-to-focus support, auto-updates, and user notifications for transcript saving that respect sendSessionTranscript configuration.

### How it fits into the larger codebase

This feature loader (loader.ts) is registered with @/plugin/src/installer/features/loaderRegistry.ts and executed by @/plugin/src/installer/install.ts during installation. Unlike other feature loaders that copy files, the hooks loader writes hook configurations into ~/.claude/settings.json using Claude Code's native hooks system. Hook scripts from @/plugin/src/installer/features/hooks/config are referenced via absolute paths in the settings.json configuration. The summarization hooks call @/plugin/src/api/conversation.ts to create summary artifacts in the backend.

### Core Implementation

The loader.ts defines four HookInterface objects (summarizeHook, summarizeNotificationHook, autoupdateHook, notifyHook), each providing an install() function that returns hook configurations. For paid installations, configurePaidHooks() installs all four hooks across SessionEnd, PreCompact, SessionStart, and Notification events. For free installations, configureFreeHooks() installs only the autoupdate and notification hooks. The loader reads existing settings.json, merges the hooks configuration into the settings object, and writes it back. The validate() function ensures all expected hooks are present and properly configured, checking for both the event types and the specific commands in each hook. Each hook points to a compiled JavaScript file in @/plugin/src/installer/features/hooks/config using Node.js to execute them.

### Things to Know

Hook installation varies by mode: paid installations get conversation memorization hooks (SessionEnd, PreCompact) plus autoupdate and notifications, while free installations only get autoupdate (SessionStart) and desktop notifications (Notification). The settings.json structure uses event matchers ('\*' for all sessions, 'auto' for automatic compaction, 'startup' for session start) to control when hooks fire. The summarizeNotificationHook must be registered before summarizeHook in paid mode to ensure users see the notification synchronously before the async summarization begins. Both summarizeNotificationHook and summarizeHook check sendSessionTranscript configuration from disk config to provide consistent user messaging when transcripts are disabled. All hooks gracefully handle errors and exit with code 0 to avoid disrupting Claude Code sessions. The validate() function performs deep inspection of settings.json to verify not just that hooks exist, but that specific scripts (summarize-notification.js, summarize.js, autoupdate.js, notify-hook.sh) are referenced in the correct events.

Desktop notifications support click-to-focus functionality on Linux X11 and macOS when optional dependencies are installed. On Linux X11, notify-hook.sh captures the active terminal window ID using xdotool before sending the notification, then uses wmctrl or xdotool to restore focus when the user clicks. On macOS, terminal-notifier with the -activate flag brings focus back to the terminal app (auto-detected from $TERM_PROGRAM). Both platforms gracefully degrade to basic notifications without optional tools (wmctrl/xdotool on Linux, terminal-notifier on macOS). Wayland is not yet supported for click-to-focus due to its stricter security model around window management. See @/plugin/src/installer/features/hooks/config/docs.md for installation instructions for optional dependencies.
