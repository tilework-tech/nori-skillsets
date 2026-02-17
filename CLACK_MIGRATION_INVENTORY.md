# Clack Prompts Migration Inventory

## Overview

This document tracks the migration of all CLI output from the legacy
`@/cli/logger.js` (winston-based `console.log`/`console.error`) and raw
`process.stdout.write`/`process.stderr.write` calls to the standard
`@clack/prompts` API (`log.*`, `intro`, `outro`, `note`, `spinner`, etc.).

---

## Allowed Exceptions

These commands intentionally emit raw stdout for scripting / machine
consumption and must **not** be migrated:

| Command | File | Output Method | Rationale |
|---------|------|---------------|-----------|
| `list` | `commands/list-skillsets/listSkillsets.ts` | `process.stdout.write` | One profile per line for piping |
| `current` | `commands/current-skillset/currentSkillset.ts` | `process.stdout.write` | Single line for piping |
| `completion` | `commands/completion/completion.ts` | `process.stdout.write` | Shell sourcing script |
| `dir --non-interactive` | `commands/dir/dir.ts` | `process.stdout.write` | Scripting path |
| `install-location -n` | `commands/install-location/installLocation.ts` | `process.stdout.write` | Scripting path |

Claude Code **hooks** use `console.log(JSON.stringify(...))` to speak the hook
protocol and must also stay as-is:

| File | Reason |
|------|--------|
| `hooks/config/update-check.ts` | Hook protocol (`systemMessage`) |
| `hooks/config/commit-author.ts` | Hook protocol (`hookSpecificOutput`) |
| `hooks/config/context-usage-warning.ts` | Hook protocol (`systemMessage`) |

The **watch daemon** background mode (`watch.ts`, `watcher.ts`) writes to a
log file via `process.stdout.write` / `console.error` while detached —
also intentional.

---

## Commands Already Fully Using Clack

| Command | Notes |
|---------|-------|
| `logout` | `log.info`, `log.success` |
| `new` | `log`, `note`, `outro` + flow |
| `fork` | `log`, `note`, `outro` |
| `register` | `log`, `note`, `outro` + flow |
| `edit` | `log`, `note`, `outro` |
| `install-location` | Interactive path uses `log`, `note`, `outro` |
| `dir` | Interactive path uses `log`, `outro` |
| `watch` | Interactive delegates to `watchFlow` (clack) |

---

## What Still Needs Migration

### Phase 1 — Pre-flow validation errors (drop-in swaps)

Simple `error()` / `warn()` / `info()` from `@/cli/logger.js` replaced
with `log.error()` / `log.warn()` / `log.info()` from `@clack/prompts`.

| Command | File | Logger calls to replace |
|---------|------|------------------------|
| `login` | `commands/login/login.ts` | `error()`, `warn()` from logger; one `console.error()` |
| `download` | `commands/registry-download/registryDownload.ts` | `error()`, `info()` from logger |
| `upload` | `commands/registry-upload/registryUpload.ts` | `error()`, `info()` from logger (including dry-run) |
| `search` | `commands/registry-search/registrySearch.ts` | `error()` from logger |
| `download-skill` | `commands/skill-download/skillDownload.ts` | `error()` from logger |
| `switch` | `commands/switch-profile/profiles.ts` | `error()` from logger + `setSilentMode` |
| `factory-reset` | `commands/factory-reset/factoryReset.ts` | `error()` from logger |

### Phase 2 — Medium commands with scattered logger usage

| Command | File | Logger calls |
|---------|------|-------------|
| `registry-install` | `commands/registry-install/registryInstall.ts` | `error`, `success`, `info`, `warn`, `newline` |
| `external` | `commands/external/external.ts` | `error`, `success`, `info`, `warn`, `newline` |

### Phase 3 — `init` non-interactive path

| Command | File | Logger calls |
|---------|------|-------------|
| `init` (non-interactive) | `commands/init/init.ts` | `warn`, `info`, `newline`, `success` |

### Phase 4 — `install` command and ASCII art

| Module | File | Logger calls |
|--------|------|-------------|
| `install` | `commands/install/install.ts` | `error`, `success`, `info`, `newline`, `setSilentMode`, `console.log` suppression |
| ASCII art | `commands/install/asciiArt.ts` | `raw`, `newline` |

### Phase 5 — Update checker

| Module | File | Output method |
|--------|------|--------------|
| Update checker | `updates/checkForUpdate.ts` | `process.stderr.write` |
| Update prompt | `updates/updatePrompt.ts` | `process.stderr.write`, raw ANSI, `readline` |

### Phase 6 — Deprecate console logger

Once all consumers are migrated, remove/deprecate the console transport
methods in `logger.ts` (`error`, `success`, `info`, `warn`, `raw`,
`newline`, `setSilentMode`). Keep the file transport (`debug`) and color
helpers.
