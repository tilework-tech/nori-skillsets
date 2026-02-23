# Noridoc: watch

Path: @/src/cli/commands/watch

### Overview

The watch command monitors Claude Code session files and copies transcripts to `~/.nori/transcripts/` for optional upload to an organization's registry. It runs as a background daemon with PID file management, file watching via chokidar, and a periodic stale transcript scanner that uploads completed sessions.

### How it fits into the larger codebase

Registered via `@/src/cli/commands/noriSkillsetsCommands.ts` with a `stop` subcommand. The interactive flow is handled by `@/cli/prompts/flows/watch.js`. Transcript uploads go through `@/api/transcript.js`. Configuration for transcript destination org is persisted to `.nori-config.json` via `@/cli/config.js`.

### Core Implementation

`watchMain` has two modes. In foreground (default), it runs the interactive flow to select a transcript destination org, stops any existing daemon, then spawns a detached background process with the `--_background` flag. In background mode, it initializes the file watcher, PID file, log file, transcript registry, and stale scanner.

The data pipeline is:

```
Claude Code writes .jsonl -> chokidar detects change -> handleFileEvent
  -> extractSessionId (regex, no JSON parse) -> copyTranscript to ~/.nori/transcripts/{agent}/{project}/
  -> stale scanner detects idle files -> processTranscriptForUpload -> transcript API -> delete local file
```

`watcher.ts` wraps chokidar with polling mode for cross-platform reliability. It filters for `.jsonl` files and emits `add`/`change` events.

`parser.ts` extracts UUID-format `sessionId` values from JSONL files using regex without full JSON parsing.

`paths.ts` provides agent-agnostic filesystem path calculations: transcript storage dirs, PID file, log file, and registry DB path.

`storage.ts` handles copying transcript files to the destination directory, named by session ID.

`staleScanner.ts` periodically scans transcript directories for `.jsonl` files. Files idle longer than 30 seconds are considered stale (ready for upload); files idle longer than 24 hours are expired and deleted.

`uploader.ts` reads, parses, and uploads transcript files via `transcriptApi.upload`, then deletes the local file on success.

`transcriptRegistry.ts` is a SQLite-backed (via `better-sqlite3`) deduplication layer. It tracks session ID + content hash pairs to avoid re-uploading unchanged transcripts.

### Things to Know

File events are debounced at 500ms per file path. The stale scanner runs every 10 seconds. The daemon writes logs to `~/.nori/logs/watch.log` since stdout/stderr are detached. Signal handlers (SIGTERM, SIGINT) trigger graceful shutdown that stops the watcher, closes the registry DB, removes the PID file, and clears all state. The `cleanupWatch` function resets all module-level state for test isolation.

Created and maintained by Nori.
