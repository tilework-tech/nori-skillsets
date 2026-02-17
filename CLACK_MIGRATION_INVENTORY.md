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
| `init` | Interactive uses `initFlow` (clack); non-interactive uses `log`, `note` |

---

## Migration Rules (standardized from Phase 1)

### Source file changes

**Imports:**
- Add `import { log } from "@clack/prompts";` in the external-packages
  import group (after node builtins, alphabetically alongside `semver`,
  `tar`, etc.).
- Remove UI functions (`error`, `info`, `warn`, `success`, `raw`,
  `newline`) from `@/cli/logger.js` imports.
- Keep non-UI utilities (`setSilentMode`, `isSilentMode`, `debug`) in
  `@/cli/logger.js` — these are not migrated.
- If the logger import becomes empty, delete it entirely.

**Call replacements:**

| Before | After |
|--------|-------|
| `error({ message: "..." })` | `log.error("...")` |
| `warn({ message: "..." })` | `log.warn("...")` |
| `info({ message: "..." })` | `log.info("...")` |
| `success({ message: "..." })` | `log.success("...")` |
| `newline()` | Remove — clack `log.*()` methods include their own spacing |
| `raw({ message: "..." })` | Case-by-case; see Phase 4 notes for ASCII art |

The transformation is always: unwrap the `{ message: ... }` object and
pass the string directly. Multi-line messages with `\n` in template
literals are preserved as-is.

**Choosing `log.warn` vs `log.info`:** Match the semantic intent of the
message, not the original function name. If the old code used `info()`
but the message text is a warning (e.g. "Could not persist...",
"Warning: ..."), use `log.warn()`. If it's genuinely informational
(e.g. "Installing...", "Setting up..."), use `log.info()`.

### Test file changes

**Add `@clack/prompts` mock** (if not already present):

```typescript
vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: "",
  })),
  confirm: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
}));
```

**Keep the `@/cli/logger.js` mock** — it still suppresses any remaining
logger output from transitive dependencies.

**Assertion pattern:**

| Before | After |
|--------|-------|
| `const { error } = await import("@/cli/logger.js")` | `const clack = await import("@clack/prompts")` |
| `expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("...") }))` | `expect(clack.log.error).toHaveBeenCalledWith(expect.stringContaining("..."))` |

Same pattern for `warn`, `info`, `success`.

If the test file uses `mockConsoleError` / `mockConsoleLog` helpers
instead of importing the logger, replace with `getClackErrorOutput()` /
`getClackOutput()` / `getAllClackOutput()` helpers (see
`registryDownload.test.ts` for reference).

Remove unused mock variables (`mockConsoleError`, `mockConsoleLog`)
or prefix with `_` if still needed for the mock setup.

### Verification checklist

After each file is migrated:

1. `npm run format`
2. `npm run lint` (types + eslint + prettier)
3. `npx vitest run <test-file>` — all tests in the affected file pass
4. Full `npm test` before committing — no regressions

---

## What Still Needs Migration

### Phase 1 — Pre-flow validation errors (drop-in swaps) ✅ DONE

Completed in commit `5d1656b`. All `error()` / `warn()` / `info()` calls
from `@/cli/logger.js` replaced with `log.error()` / `log.warn()` /
`log.info()` from `@clack/prompts`. Tests updated in all affected files.

| Command | File | Status |
|---------|------|--------|
| `login` | `commands/login/login.ts` | ✅ Migrated |
| `download` | `commands/registry-download/registryDownload.ts` | ✅ Migrated |
| `upload` | `commands/registry-upload/registryUpload.ts` | ✅ Migrated |
| `search` | `commands/registry-search/registrySearch.ts` | ✅ Migrated |
| `download-skill` | `commands/skill-download/skillDownload.ts` | ✅ Migrated |
| `switch` | `commands/switch-profile/profiles.ts` | ✅ Migrated |
| `factory-reset` | `commands/factory-reset/factoryReset.ts` | ✅ Migrated |

### Phase 2 — Medium commands with scattered logger usage ✅ DONE

Completed on the `feat/migrate-loggers` branch. All `error()` / `success()` /
`info()` / `warn()` / `newline()` calls from `@/cli/logger.js` replaced with
`log.error()` / `log.success()` / `log.info()` / `log.warn()` from
`@clack/prompts`. `newline()` calls removed (clack handles spacing).
Two `info({ message: "Warning: ..." })` calls in `external.ts` were
corrected to `log.warn()` per semantic intent. Tests updated in all
affected files.

| Command | File | Status |
|---------|------|--------|
| `registry-install` | `commands/registry-install/registryInstall.ts` | ✅ Migrated |
| `external` | `commands/external/external.ts` | ✅ Migrated |

### Phase 3 — `init` non-interactive path ✅ DONE

Completed on the `feat/migrate-loggers` branch. The ancestor installation
warning block (previously scattered `warn()` / `info()` / `newline()` calls)
was consolidated into a single `note()` call with a `"Warning"` title and
colored content using `yellow()` and `bold()` from `@/cli/logger.js` color
helpers. The `success()` call for config capture was replaced with
`log.success()`. A new `yellow()` color helper was added to `logger.ts`.
Tests updated to assert on `clack.note` and `clack.log.success`.

| Command | File | Status |
|---------|------|--------|
| `init` (non-interactive) | `commands/init/init.ts` | ✅ Migrated |

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
