# Noridoc: watch

Path: @/src/cli/commands/watch

### Overview

- Background daemon that monitors Claude Code sessions, saves transcripts to `~/.nori/transcripts/`, and uploads them to a user-selected private organization
- Watches `~/.claude/projects/` for JSONL file changes using chokidar with polling mode
- Uses stale-based uploads: files not modified for 30+ seconds are scanned periodically and uploaded
- SQLite registry tracks uploaded transcripts to prevent duplicate uploads
- Transcripts idle for 24+ hours are automatically deleted to prevent indefinite accumulation
- Prompts user to select transcript destination organization on first run (if multiple orgs available)

### How it fits into the larger codebase

- Registered via `registerNoriSkillsetsWatchCommand()` in @/src/cli/commands/noriSkillsetsCommands.ts
- Available as `nori-skillsets watch` and `nori-skillsets watch stop` commands
- Does not require Nori installation - operates independently on Claude Code session files
- Uses the shared logger from @/src/cli/logger.ts for console output (`info`, `success`, `warn`); when `experimentalUi` is enabled, `watchStopMain` swaps log calls to `@clack/prompts` equivalents (`clack.log.success`, `clack.log.warn`, `clack.log.info`) and `watchMain` delegates to `watchFlow` from @/src/cli/prompts/flows/watch.ts
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
    +-- Initialize SQLite transcript registry at ~/.nori/transcripts/registry.db
    +-- Start stale transcript scanner (10 second interval)
    +-- Register SIGTERM/SIGINT handlers for graceful shutdown

nori-skillsets watch stop
    |
    +-- Read PID from ~/.nori/watch.pid (must happen BEFORE cleanup)
    +-- Clean up local state via cleanupWatch() (deletes PID file)
    +-- Kill daemon process using stored PID (if different process)
```

**File Processing Pipeline:**
```
JSONL file change detected (in ~/.claude/projects/)
    |
    +-- Debounce check: skip if lastEventTime for this file < DEBOUNCE_MS (500ms) ago
    +-- paths.ts: Extract project name from file path
    +-- parser.ts: Extract sessionId (UUID) via regex
    +-- storage.ts: Copy to ~/.nori/transcripts/<agent>/<project>/<sessionId>.jsonl
```

**Transcript Upload Pipeline (stale-based):**
```
Stale scanner runs every SCAN_INTERVAL_MS (10 seconds)
    |
    +-- staleScanner.ts: findStaleTranscripts() recursively scans transcript storage directory
    |   +-- Returns staleFiles: .jsonl files older than STALE_THRESHOLD_MS (30s) but younger than EXPIRE_THRESHOLD_MS (24h)
    |   +-- Returns expiredFiles: .jsonl files older than EXPIRE_THRESHOLD_MS (24 hours)
    +-- Delete all expired files first (cleanup)
    +-- For each stale file:
    |   +-- Skip if already in uploadingFiles Set (concurrent upload in progress)
    |   +-- Extract sessionId from file content
    |   +-- Compute MD5 hash of file content
    |   +-- Check registry: isUploaded({ sessionId, fileHash })
    |   +-- If already uploaded with same hash, skip
    |   +-- Add to uploadingFiles Set
    |   +-- uploader.ts: processTranscriptForUpload({ transcriptPath, orgId })
    |   +-- On success: registry.markUploaded({ sessionId, fileHash, transcriptPath })
    |   +-- Remove from uploadingFiles Set
```

**Claude Code Session Format:**
- Sessions stored at `~/.claude/projects/<project-dir>/*.jsonl`
- Project directory naming: path with non-alphanumeric chars replaced by dashes (e.g., `/Users/ritam/myproject` becomes `-Users-ritam-myproject`)
- Each JSONL entry contains a `sessionId` UUID field

**Module Responsibilities:**

| Module | Purpose |
|--------|---------|
| `watch.ts` | Main daemon orchestration, signal handlers, logging, event debouncing, upload locking, stale scanning, expired file cleanup, transcript destination selection |
| `paths.ts` | Path utilities for Claude projects dir, transcript storage, registry database |
| `parser.ts` | Extracts sessionId from JSONL using regex (avoids full JSON parsing) |
| `storage.ts` | Copies transcript files to organized storage |
| `watcher.ts` | Chokidar wrapper with polling mode for reliable cross-platform watching |
| `staleScanner.ts` | Recursively finds .jsonl files, categorizes as stale (ready for upload) or expired (should delete) |
| `transcriptRegistry.ts` | SQLite-based registry for tracking uploaded transcripts by sessionId and content hash |
| `uploader.ts` | Reads JSONL transcripts, parses messages, uploads via transcriptApi |

### Things to Know

**Why Stale-Based Instead of Event-Driven:**
- The previous hook-based system relied on Claude Code SessionEnd hooks to create `.done` marker files
- If hooks failed to fire or markers weren't detected, transcripts wouldn't upload
- The stale-based approach is self-healing: any transcript not modified for 30 seconds gets picked up on the next scan
- Polling-based scanning trades slight latency for reliability

**Transcript Registry (SQLite):**
- Database location: `~/.nori/transcripts/registry.db`
- Schema: `uploads` table with `session_id` (PRIMARY KEY), `file_hash`, `uploaded_at`, `transcript_path`
- Tracks uploads by sessionId AND content hash, enabling re-upload detection when content changes
- `isUploaded()` returns true only if sessionId exists AND hash matches (same content)
- `INSERT OR REPLACE` handles content updates - if a transcript is re-uploaded with different content, the registry updates

**Timing Constants:**
- `DEBOUNCE_MS = 500` - Window for ignoring duplicate chokidar events
- `STALE_THRESHOLD_MS = 30000` - Files must be unmodified for 30 seconds to be considered for upload
- `EXPIRE_THRESHOLD_MS = 86400000` (24 hours) - Files older than this are deleted
- `SCAN_INTERVAL_MS = 10000` - Stale scanner runs every 10 seconds

**File Lifecycle:**
1. Transcripts are copied from `~/.claude/projects/` to `~/.nori/transcripts/<agent>/<project>/`
2. Files not modified for 30+ seconds are uploaded (if not already uploaded with same hash)
3. Registry records the upload (sessionId, hash, path)
4. Files idle for 24+ hours are deleted during the next scan
5. If a file is modified (user resumes session), it can be re-uploaded with the new content

**Concurrency Protection:**
- `uploadingFiles` Set prevents concurrent uploads of the same file path
- `lastEventTime` Map debounces rapid file change events
- Both are cleared in `cleanupWatch()` to ensure clean state for subsequent daemon runs

**Platform Considerations:**
- Uses chokidar with `usePolling: true` for reliability across platforms (native fsevents can be flaky in temp directories)
- The `getHomeDir()` function respects `process.env.HOME` for test isolation

**PID File Management:**
- `watchStopMain()` must read the PID file before calling `cleanupWatch()`, since cleanup deletes the PID file; otherwise the daemon becomes an orphan process

**Transcript Destination Selection:**
- `selectTranscriptDestination()` determines which org receives uploads (legacy path)
- Filters out "public" from available organizations (only private orgs can receive transcripts)
- If configured destination is no longer in user's organization list (lost access), triggers re-selection
- In daemon mode with multiple orgs, auto-selects first org with a warning

**Experimental UI (`experimentalUi`):**
- `watchMain` accepts an `experimentalUi` parameter. When enabled and not in background daemon mode (`!_background`), it delegates the entire interactive flow to `watchFlow` from @/src/cli/prompts/flows/watch.ts via dynamic import. The flow handles org selection via `@clack/prompts` `select()` instead of the legacy `promptUser` readline approach. Two callbacks are provided: `onPrepare` (stops existing daemon, loads config, returns private orgs) and `onStartDaemon` (saves config if destination changed, spawns the daemon process).
- `watchStopMain` accepts an `experimentalUi` parameter. When enabled, it replaces `success()`, `warn()`, `info()` calls with dynamically imported `@clack/prompts` `log.success()`, `log.warn()`, `log.info()`. This is a simpler approach than a full flow since `watchStopMain` has no interactive prompts.
- The `experimentalUi` flag is wired from the global `--experimental-ui` option in `registerNoriSkillsetsWatchCommand()` in @/src/cli/commands/noriSkillsetsCommands.ts for both `watch` and `watch stop` subcommands.

Created and maintained by Nori.
