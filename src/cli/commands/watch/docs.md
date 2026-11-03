# Noridoc: watch

Path: @/src/cli/commands/watch

### Overview

The watch command is retired. It used to tail Claude Code session files and upload whole transcripts to the organization's registrar at `/api/transcripts`. Registrars no longer serve that endpoint (registrar #396), and older registrars that still do were overwhelmed by the repeated full-transcript uploads. The command is kept only so that existing scripts, shell aliases, and running daemons do not crash. It never uploads, copies, or watches anything.

### How it fits into the larger codebase

Registered via `@/src/cli/commands/noriSkillsetsCommands.ts` with a `stop` subcommand. The legacy `--agent`, `--set-destination`, and internal `--_background` options are still accepted and ignored, so old invocations parse cleanly. No analytics event is emitted for watch; only the generic command-completion tracking in @/src/cli/installTracking.ts applies. The `transcriptDestination` and `garbageCollectTranscripts` fields in `.nori-config.json` (@/src/cli/config.ts) are no longer read by watch but remain in the config schema so existing config files are not rewritten.

### Core Implementation

`watchMain`:

- Foreground (default): calls `watchStopMain({ quiet: true })` to stop any daemon left running by an older version, then returns success with `WATCH_RETIRED_MESSAGE`, which the framing wrapper prints as the outro. It does not spawn a background process.
- `--_background`: appends `WATCH_RETIRED_MESSAGE` to `~/.nori/logs/watch.log` (stdout is detached in that mode) and returns immediately without writing a PID file.

`watchStopMain` reads `~/.nori/watch.pid` and removes it. It sends `SIGTERM` only when the recorded PID is not the current process and its command line (`/proc/<pid>/cmdline` on Linux, `ps -o command=` elsewhere) contains both `watch` and `--_background`, the signature of a daemon spawned by an older release. This keeps a stale PID file from signalling an unrelated process that reused the PID. It then waits up to 2 seconds for the process to exit (a zombie counts as exited, since container PID 1s may never reap it) and returns `{ stoppedPid }`. Foreground `watch` includes the stopped PID in its outro.

`stopLegacyDaemon.ts` is a direct-execution entry point run by the npm `postinstall` script (after `cleanupLegacyHooks.js`). It calls `watchStopMain({ quiet: true })` and never fails the install.

`paths.ts` provides the PID file (`~/.nori/watch.pid`) and log file (`~/.nori/logs/watch.log`) locations.

### Things to Know

A daemon started by an older release keeps running its old in-memory code after the package is upgraded. The `postinstall` hook stops it on upgrade; running `nori-skillsets watch` or `nori-skillsets watch stop` on the new version also stops it (for example when install scripts were disabled with `--ignore-scripts`). Leftover `~/.nori/transcripts/` copies and `registry.db` from older releases are not touched.

Created and maintained by Nori.
