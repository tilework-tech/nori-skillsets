# Noridoc: watch

Path: @/src/cli/commands/watch

### Overview

- Background daemon that monitors Claude Code sessions, saves transcripts to `~/.nori/transcripts/`, and uploads them to the user's private registry
- Watches `~/.claude/projects/` for JSONL file changes using chokidar with polling mode
- Uses a hybrid upload strategy: marker-based for immediate upload when sessions end, staleness-based fallback for agents without hook support

### How it fits into the larger codebase

- Registered via `registerNoriSkillsetsWatchCommand()` in @/src/cli/commands/noriSkillsetsCommands.ts
- Available as `nori-skillsets watch` and `nori-skillsets watch stop` commands
- Does not require Nori installation - operates independently on Claude Code session files
- Uses the shared logger from @/src/cli/logger.ts for console output (`info`, `success`, `warn`)
- Follows the standard command pattern: exports `watchMain()` and `watchStopMain()` functions that the registration wrapper calls

### Core Implementation

**Daemon Lifecycle:**
```
nori-skillsets watch
    |
    +-- Check if already running (via PID file)
    +-- Create PID file at ~/.nori/watch.pid
    +-- Open log file at ~/.nori/logs/watch.log
    +-- Start chokidar watcher on ~/.claude/projects/
    +-- Register SIGTERM/SIGINT handlers for graceful shutdown

nori-skillsets watch stop
    |
    +-- Read PID from ~/.nori/watch.pid
    +-- Send SIGTERM to the daemon process
    +-- Clean up PID file
```

**File Processing Pipeline:**
```
JSONL file change detected
    |
    +-- paths.ts: Extract project name from file path
    +-- parser.ts: Extract sessionId (UUID) via regex
    +-- storage.ts: Copy to ~/.nori/transcripts/<agent>/<project>/<sessionId>.jsonl
    +-- Track file in fileLastModified Map for staleness detection
```

**Transcript Upload Pipeline (marker-based):**
```
Claude Code session ends
    |
    +-- transcript-done-marker hook writes .done marker to ~/.nori/transcripts/<agent>/<project>/
    +-- watch daemon detects marker via chokidar watcher on transcript directory
    +-- handleMarkerEvent() derives transcript path from marker (.done -> .jsonl)
    +-- uploader.ts: processTranscriptForUpload() reads, parses, uploads via transcriptApi
    +-- On success: delete both transcript and marker files
```

**Transcript Upload Pipeline (staleness-based fallback):**
```
checkStaleTranscripts() runs every 60 seconds
    |
    +-- Iterate fileLastModified Map
    +-- If (now - lastModified) >= staleTimeoutMs (default 5 minutes):
        +-- Upload via processTranscriptForUpload()
        +-- On success: delete transcript, remove from tracking
        +-- On failure: reset timestamp to retry later
```

**Claude Code Session Format:**
- Sessions stored at `~/.claude/projects/<project-dir>/*.jsonl`
- Project directory naming: path with non-alphanumeric chars replaced by dashes (e.g., `/Users/ritam/myproject` becomes `-Users-ritam-myproject`)
- Each JSONL entry contains a `sessionId` UUID field

**Module Responsibilities:**

| Module | Purpose |
|--------|---------|
| `watch.ts` | Main daemon orchestration, signal handlers, logging, staleness tracking, upload coordination |
| `paths.ts` | Path utilities for Claude projects dir and transcript storage |
| `parser.ts` | Extracts sessionId from JSONL using regex (avoids full JSON parsing) |
| `storage.ts` | Copies transcript files to organized storage |
| `watcher.ts` | Chokidar wrapper with polling mode for reliable cross-platform watching |
| `hookInstaller.ts` | Manages installation/removal of transcript-done-marker hook in Claude Code settings.json |
| `uploader.ts` | Reads JSONL transcripts, parses messages, uploads via transcriptApi, cleans up files on success |

### Things to Know

- Uses chokidar with `usePolling: true` for reliability across platforms (native fsevents can be flaky in temp directories)
- The `isShuttingDown` flag prevents race conditions during cleanup
- `cleanupWatch()` accepts `exitProcess` parameter for testability (tests pass `false` to avoid calling `process.exit()`)
- The `--agent` flag allows future extensibility for watching other agents (e.g., Cursor), but currently only claude-code is supported
- PID file at `~/.nori/watch.pid` enables single-instance enforcement and remote stop capability
- Log file at `~/.nori/logs/watch.log` captures daemon activity when running in background mode
- The `getHomeDir()` function respects `process.env.HOME` for test isolation

**Transcript Upload Integration:**
- On `watchMain()` startup, `installTranscriptHook()` is called to register the transcript-done-marker hook in `~/.claude/settings.json` (idempotent - won't duplicate if already present)
- On `watchStopMain()`, `removeTranscriptHook()` is called before cleanup to unregister the hook
- The daemon watches two directories: (1) `~/.claude/projects/` for raw session files, (2) `~/.nori/transcripts/<agent>/` for .done marker files
- The `fileLastModified` Map tracks transcript paths and their last modification timestamps for staleness detection
- `scanExistingTranscripts()` runs after `staleTimeoutMs` delay on startup to pick up pre-existing transcripts
- Upload failures preserve files for retry; successful uploads delete both transcript and marker files
- The hybrid approach ensures transcripts are uploaded promptly for hook-aware agents (Claude Code) while still supporting hook-unaware agents (Cursor) via staleness detection

**hookInstaller.ts Implementation:**
- Reads/writes `~/.claude/settings.json` directly (via `getClaudeHomeSettingsFile()` from @/src/cli/features/claude-code/paths.ts)
- Creates `hooks.SessionEnd` array if missing, appends matcher with hook command `node {path}/transcript-done-marker.js`
- Uses `hasOurHook()` to check for existing installation by matching "transcript-done-marker" in command strings
- `removeTranscriptHook()` filters out the hook entry while preserving other SessionEnd hooks

**uploader.ts Implementation:**
- `parseTranscript({ content })` splits JSONL by newlines, parses each line, skips invalid JSON
- `extractSessionId({ messages })` iterates messages looking for first truthy `sessionId` field
- `processTranscriptForUpload({ transcriptPath, markerPath? })` orchestrates the full upload flow: read -> parse -> validate -> upload -> cleanup
- Returns `true` on successful upload, `false` on any failure (preserves files for retry)

Created and maintained by Nori.
