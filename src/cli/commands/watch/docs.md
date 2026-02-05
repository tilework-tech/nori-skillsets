# Noridoc: watch

Path: @/src/cli/commands/watch

### Overview

- Background daemon that monitors Claude Code sessions, saves transcripts to `~/.nori/transcripts/`, and uploads them to a user-selected private organization
- Watches `~/.claude/projects/` for JSONL file changes using chokidar with polling mode
- Uses marker-based uploads: uploads are triggered exclusively when `.done` marker files are created by the Claude Code session end hook
- Prompts user to select transcript destination organization on first run (if multiple orgs available)

### How it fits into the larger codebase

- Registered via `registerNoriSkillsetsWatchCommand()` in @/src/cli/commands/noriSkillsetsCommands.ts
- Available as `nori-skillsets watch` and `nori-skillsets watch stop` commands
- Does not require Nori installation - operates independently on Claude Code session files
- Uses the shared logger from @/src/cli/logger.ts for console output (`info`, `success`, `warn`)
- Follows the standard command pattern: exports `watchMain()` and `watchStopMain()` functions that the registration wrapper calls

### Core Implementation

**Daemon Lifecycle:**
```
nori-skillsets watch [--set-destination]
    |
    +-- Check if already running (via PID file)
    +-- Load config and determine transcript destination org
    |   +-- Filter out "public" org from user's organizations
    |   +-- If --set-destination flag: force re-selection
    |   +-- If single private org: auto-select
    |   +-- If multiple private orgs: prompt user to select
    |   +-- Save selection to config.transcriptDestination
    +-- Create PID file at ~/.nori/watch.pid
    +-- Open log file at ~/.nori/logs/watch.log
    +-- Start chokidar watcher on ~/.claude/projects/
    +-- Register SIGTERM/SIGINT handlers for graceful shutdown

nori-skillsets watch stop
    |
    +-- Remove transcript hook from Claude Code settings
    +-- Read PID from ~/.nori/watch.pid (must happen BEFORE cleanup)
    +-- Clean up local state via cleanupWatch() (deletes PID file)
    +-- Kill daemon process using stored PID (if different process)
```

**File Processing Pipeline:**
```
JSONL file change detected
    |
    +-- Debounce check: skip if lastEventTime for this file < DEBOUNCE_MS (500ms) ago
    +-- paths.ts: Extract project name from file path
    +-- parser.ts: Extract sessionId (UUID) via regex
    +-- storage.ts: Copy to ~/.nori/transcripts/<agent>/<project>/<sessionId>.jsonl
```

**Transcript Upload Pipeline (marker-based):**
```
Claude Code session ends
    |
    +-- transcript-done-marker hook writes .done marker to ~/.nori/transcripts/<agent>/<project>/
    +-- watch daemon detects marker via chokidar watcher on transcript directory
    +-- handleMarkerEvent() derives transcript path from marker (.done -> .jsonl) BEFORE debounce check
    |   +-- Debounce check uses transcriptPath (not markerPath) to prevent duplicates when
    |       chokidar emits both 'add' and 'change' events for the same marker file creation
    |   +-- Checks uploadingFiles Set to prevent concurrent uploads of same file
    |   +-- Adds transcript path to uploadingFiles Set before upload
    +-- uploader.ts: processTranscriptForUpload({ transcriptPath, markerPath, orgId })
    |   +-- Reads and parses JSONL transcript
    |   +-- Uploads via transcriptApi.upload() with orgId for org-specific URL targeting
    +-- On success: delete both transcript and marker files
    +-- Finally: removes transcript path from uploadingFiles Set (whether success or failure)
```

**Claude Code Session Format:**
- Sessions stored at `~/.claude/projects/<project-dir>/*.jsonl`
- Project directory naming: path with non-alphanumeric chars replaced by dashes (e.g., `/Users/ritam/myproject` becomes `-Users-ritam-myproject`)
- Each JSONL entry contains a `sessionId` UUID field

**Module Responsibilities:**

| Module | Purpose |
|--------|---------|
| `watch.ts` | Main daemon orchestration, signal handlers, logging, event debouncing, upload locking, transcript destination selection |
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
- The `--set-destination` flag forces re-selection of the transcript destination organization, even if one is already configured
- PID file at `~/.nori/watch.pid` enables single-instance enforcement and remote stop capability
- Log file at `~/.nori/logs/watch.log` captures daemon activity when running in background mode
- The `getHomeDir()` function respects `process.env.HOME` for test isolation
- `watchStopMain()` must read the PID file before calling `cleanupWatch()`, since cleanup deletes the PID file; otherwise the daemon becomes an orphan process

**Transcript Upload Integration:**
- On `watchMain()` startup, `installTranscriptHook()` is called to register the transcript-done-marker hook in `~/.claude/settings.json` (idempotent - won't duplicate if already present)
- On `watchStopMain()`, `removeTranscriptHook()` is called before cleanup to unregister the hook
- The daemon watches two directories: (1) `~/.claude/projects/` for raw session files, (2) `~/.nori/transcripts/<agent>/` for .done marker files
- Upload failures preserve files for retry; successful uploads delete both transcript and marker files
- Uploads are triggered exclusively by `.done` marker files (created when Claude Code sessions end via the session end hook)

**Duplicate Upload Prevention:**
- **Event debouncing:** `lastEventTime` Map tracks the timestamp of the last processed event per transcript path (derived from the marker path before debounce check). Events within `DEBOUNCE_MS` (500ms) are skipped. Using the transcript path as the debounce key (rather than the marker path) prevents duplicate uploads when chokidar emits both 'add' and 'change' events for the same marker file creation, which commonly occurs in polling mode.
- **Upload locking:** `uploadingFiles` Set tracks transcripts currently being uploaded; concurrent upload attempts for the same file are skipped and logged
- Both mechanisms are cleared in `cleanupWatch()` to ensure clean state for subsequent daemon runs

**hookInstaller.ts Implementation:**
- Reads/writes `~/.claude/settings.json` directly (via `getClaudeHomeSettingsFile()` from @/src/cli/features/claude-code/paths.ts)
- Creates `hooks.SessionEnd` array if missing, appends matcher with hook command `node {path}/transcript-done-marker.js`
- Uses `hasOurHook()` to check for existing installation by matching "transcript-done-marker" in command strings
- `removeTranscriptHook()` filters out the hook entry while preserving other SessionEnd hooks

**uploader.ts Implementation:**
- `parseTranscript({ content })` splits JSONL by newlines, parses each line, skips invalid JSON
- `extractSessionId({ messages })` iterates messages looking for first truthy `sessionId` field
- `processTranscriptForUpload({ transcriptPath, markerPath?, orgId? })` orchestrates the full upload flow: read -> parse -> validate -> upload -> cleanup
- The `orgId` parameter is passed through to `transcriptApi.upload()` to target the selected organization's registry
- Returns `true` on successful upload, `false` on any failure (preserves files for retry)

**Transcript Destination Selection:**
- `selectTranscriptDestination({ privateOrgs, currentDestination?, forceSelection? })` determines which org receives uploads
- Filters out "public" from available organizations (only private orgs can receive transcripts)
- If current destination is valid and not forcing re-selection, uses existing selection
- Single private org: auto-selects without prompting
- Multiple private orgs: displays numbered list and prompts user for selection
- Invalid selection defaults to first org in list
- Selection is persisted to `config.transcriptDestination` and stored in module-level `transcriptOrgId` variable for use during uploads
- If configured destination is no longer in user's organization list (lost access), triggers re-selection

Created and maintained by Nori.
