# Noridoc: watch

Path: @/src/cli/commands/watch

### Overview

- Background daemon that monitors Claude Code sessions and saves transcripts to `~/.nori/transcripts/`
- Watches `~/.claude/projects/` for JSONL file changes using chokidar with polling mode
- Organizes transcripts by agent and project name for later analysis and retrieval

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
```

**Claude Code Session Format:**
- Sessions stored at `~/.claude/projects/<project-dir>/*.jsonl`
- Project directory naming: path with non-alphanumeric chars replaced by dashes (e.g., `/Users/ritam/myproject` becomes `-Users-ritam-myproject`)
- Each JSONL entry contains a `sessionId` UUID field

**Module Responsibilities:**

| Module | Purpose |
|--------|---------|
| `watch.ts` | Main daemon orchestration, signal handlers, logging |
| `paths.ts` | Path utilities for Claude projects dir and transcript storage |
| `parser.ts` | Extracts sessionId from JSONL using regex (avoids full JSON parsing) |
| `storage.ts` | Copies transcript files to organized storage |
| `watcher.ts` | Chokidar wrapper with polling mode for reliable cross-platform watching |

### Things to Know

- Uses chokidar with `usePolling: true` for reliability across platforms (native fsevents can be flaky in temp directories)
- The `isShuttingDown` flag prevents race conditions during cleanup
- `cleanupWatch()` accepts `exitProcess` parameter for testability (tests pass `false` to avoid calling `process.exit()`)
- The `--agent` flag allows future extensibility for watching other agents (e.g., Cursor), but currently only claude-code is supported
- PID file at `~/.nori/watch.pid` enables single-instance enforcement and remote stop capability
- Log file at `~/.nori/logs/watch.log` captures daemon activity when running in background mode
- The `getHomeDir()` function respects `process.env.HOME` for test isolation

Created and maintained by Nori.
