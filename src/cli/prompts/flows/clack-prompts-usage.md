# Clack Prompts Usage Guide

Rules for building interactive CLI flows using `@clack/prompts`.

---

## Architecture Overview

The prompts system has two layers:

### Standalone Wrappers (`src/cli/prompts/*.ts`)

Individual prompt wrappers for one-off use in commands:

- `confirmAction` - Yes/no confirmation
- `promptText` - Text input with validation
- `promptPassword` - Password input
- `selectProfile` - Profile selection from list
- `promptForAuth` - Grouped email/password/org collection

These call `handleCancel()` on cancel, which calls `process.exit(0)`.
Use for simple prompts in commands that don't need graceful flow control.

### Flows (`src/cli/prompts/flows/*.ts`)

Complete interactive experiences that orchestrate multiple clack primitives:

- `initFlow` - Initialize Nori with config detection
- `loginFlow` - Authenticate with email/password
- `switchSkillsetFlow` - Switch between skillsets with change detection
- `uploadFlow` - Upload profile to registry with conflict resolution

Flows return `null` on cancel. They never call `process.exit`.
**Flows must NOT import or use standalone wrappers.**

---

## Flow File Structure

Every flow is a single exported async function in `src/cli/prompts/flows/`.
The function does five things in order:

1. `intro()` - title for the flow
2. Prompts - collect user input
3. Callbacks with spinners - execute side effects
4. `note()` / `log.*` - display results
5. `outro()` - closing message

A flow returns a typed result object on success, or `null` on cancel/failure.

```ts
export const exampleFlow = async (args: {
  callbacks: ExampleFlowCallbacks;
}): Promise<ExampleFlowResult | null> => {
  intro("Example");
  // prompts, callbacks, display
  outro("Done");
  return result;
};
```

---

## Cancel Handling

### Use `group()` for related prompts

When collecting multiple related inputs (e.g. email + password), use `group()`.
It handles cancel in one place via its `onCancel` option:

```ts
const credentials = await group(
  {
    email: () => text({ message: "Email" }),
    password: () => password({ message: "Password" }),
  },
  {
    onCancel: () => {
      cancel("Login cancelled.");
    },
  },
);

if (isCancel(credentials)) {
  return null;
}
```

### Use `unwrapPrompt` for sequential prompts

When prompts are sequential and conditional (cannot use `group`), use the
shared helper instead of repeating `isCancel` + `cancel` + `return null`:

```ts
import { unwrapPrompt } from "./utils.js";

const selected = unwrapPrompt({
  value: await select({ message: "Pick one", options }),
  cancelMessage: "Switch cancelled.",
});
if (selected == null) return null;
```

### Never do this

Do not repeat cancel boilerplate inline at every prompt:

```ts
// BAD - verbose, duplicated at every step
if (isCancel(result)) {
  cancel("Skillset switch cancelled.");
  return null;
}
```

---

## Callbacks

### Keep the callback surface small

A flow should have 1-4 callbacks. Each callback represents a coarse operation
the caller is responsible for. The flow asks the user questions; the caller
does the work.

```ts
// GOOD - one callback for the whole auth operation
type LoginFlowCallbacks = {
  onAuthenticate: (args: {
    email: string;
    password: string;
  }) => Promise<AuthenticateResult>;
};
```

```ts
// BAD - flow micro-manages steps that are the caller's concern
type SwitchCallbacks = {
  onResolveAgents: () => Promise<...>;
  onDetectLocalChanges: (args: { ... }) => Promise<...>;
  onGetCurrentProfile: (args: { ... }) => Promise<...>;
  onCaptureConfig: (args: { ... }) => Promise<...>;
  onSwitchProfile: (args: { ... }) => Promise<...>;
  onReinstall: (args: { ... }) => Promise<...>;
};
```

When multiple operations are tightly coupled (switch profile then reinstall),
combine them into one callback. The flow does not care about internal steps -
it just needs a spinner around the whole thing.

### Use discriminated unions for failable callbacks

If a callback can fail, return a discriminated union. This lets the flow
control error UX without try/catch:

```ts
type AuthenticateResult =
  | { success: true; userEmail: string /* ... */ }
  | { success: false; error: string; hint?: string | null };
```

The flow checks `result.success` and uses `log.error()` / `note()` for
error display. No try/catch in the flow body.

---

## Intro and Outro Messages

### Intro: use infinitive verb form

The `intro()` message is a title describing what the flow will do. Use an
infinitive verb (the base form of the verb):

```ts
// GOOD - infinitive verb form
intro("Initialize Nori");
intro("Switch Skillset");
intro("Log in to Nori Skillsets");

// BAD - noun form or gerund
intro("Initialization");
intro("Login to Nori"); // "Login" is a noun; use "Log in"
intro("Switching Skillsets");
```

### Outro: use past tense or next step

The `outro()` message confirms completion. Use either:

- Past tense verb describing what was accomplished
- A next step the user should take

```ts
// GOOD - past tense
outro("Nori initialized successfully");
outro(`Logged in as ${email}`);
outro("Skillset switched");

// GOOD - next step
outro("Restart claude-code to apply");

// BAD - present tense or vague
outro("Done");
outro("Success");
outro("Nori is initialized");
```

---

## Styling and Formatting

### No inline ANSI escape codes

Do not define local ANSI helper functions in flow files. The project already
has color/formatting helpers in `@/cli/logger.ts` (`bold`, `brightCyan`,
`green`, `red`). Use those when you need formatted text inside a `note()`.
Prefer clack primitives (`note`, `log.*`, `intro`, `outro`) for visual
hierarchy.

```ts
// BAD - inline ANSI helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
note(`Current: ${bold(name)}`, "Details");

// GOOD - use existing logger helpers
import { bold, brightCyan } from "@/cli/logger.js";
note(`Current: ${brightCyan({ text: bold({ text: name }) })}`, "Details");
```

### Use `note()` for information blocks

Use `note(content, title)` to display multi-line structured information
before a prompt (e.g. switch details, detected changes).

### Use `log.error()` for errors, `log.warn()` for warnings

Do not use `note()` for errors. Use `log.error()` for the main error message
and optionally `note()` for a hint or additional context.

---

## Non-Interactive Command Output

For commands that don't have interactive prompts but need to display output,
use clack primitives instead of the legacy logger:

### Single-line output

- `log.info()` - Informational messages
- `log.success()` - Success confirmations
- `log.error()` - Error messages
- `log.step()` - Neutral status/progress messages

### Multi-line output

Use `note(content, title)` for multi-line blocks like "Next Steps":

```ts
const nextSteps = [
  `To switch:  nori-skillsets switch ${name}`,
  `To edit:    ~/.nori/profiles/${name}/`,
].join("\n");
note(nextSteps, "Next Steps");
```

### Output ordering with `outro()`

When a command completes successfully and shows both a note and a final
message, display the note first, then end with `outro()`:

```ts
// GOOD - note first, outro closes the flow
note(nextSteps, "Next Steps");
outro(`Created new skillset '${name}'`);
```

This produces cleaner visual output:

```
│
◆  Next Steps ──────────────────────────────────╮
│                                               │
│  To switch:  nori-skillsets switch my-skill   │
│  To edit:    ~/.nori/profiles/my-skill/       │
│                                               │
├───────────────────────────────────────────────╯
│
└  Created new skillset 'my-skill'
```

### Raw scripting output

For commands that may be piped or used in scripts (e.g. `list`, `completion`,
`dir --no-open`), use `process.stdout.write()` directly:

```ts
// Output raw lines for scripting
for (const profile of profiles) {
  process.stdout.write(profile + "\n");
}
```

This keeps output clean without clack formatting, suitable for `$(...)` or
pipe chains.

---

## Data Formatting Helpers

If a flow needs to format a data structure for display (e.g. a list of changed
files), extract it into a helper function in the same file. Keep it short.

```ts
// GOOD - extracted helper
const buildChangesSummary = (args: { diff: ManifestDiff }): string => {
  const { diff } = args;
  const lines: Array<string> = [];

  if (diff.modified.length > 0) {
    lines.push(`Modified (${diff.modified.length}):`);
    for (const file of diff.modified.slice(0, 5)) {
      lines.push(`  ${file}`);
    }
    if (diff.modified.length > 5) {
      lines.push(`  ... and ${diff.modified.length - 5} more`);
    }
  }
  // ...
  return lines.join("\n");
};
```

If truncation logic is needed (show first N, then "and X more"), write a
generic `truncateList` utility rather than inlining it per-flow.

---

## Validators

Validators in `src/cli/prompts/validators.ts` return `string | undefined`:

- `undefined` = valid
- `string` = error message

This matches @clack/prompts' validation callback signature.

```ts
export const validateProfileName = (args: {
  value: string;
}): string | undefined => {
  const { value } = args;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    return "Must be lowercase alphanumeric with hyphens, no leading/trailing hyphens";
  }
  return undefined;
};
```

Usage in a flow:

```ts
const profileName = unwrapPrompt({
  value: await text({
    message: "Enter a name for this skillset",
    placeholder: "my-skillset",
    validate: (value) => validateProfileName({ value: value ?? "" }),
  }),
  cancelMessage: cancelMsg,
});
```

---

## Testing Flows

Mock `@clack/prompts` at module level:

```ts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  group: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  note: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));
```

Provide mock callbacks. Assert:

1. Which clack functions were called and with what arguments
2. Which callbacks were invoked and with what arguments
3. The return value (result object or `null`)

Do NOT test clack's internal behavior. Test that the flow calls the right
prompts in the right order and passes the right data to callbacks.

---

## Current Implementation Status

### Migrated Flows

| Flow                  | Callbacks | File                   |
| --------------------- | --------- | ---------------------- |
| `initFlow`            | 4         | `flows/init.ts`        |
| `loginFlow`           | 1         | `flows/login.ts`       |
| `switchSkillsetFlow`  | 4         | `flows/switchSkillset.ts` |
| `uploadFlow`          | 2         | `flows/upload.ts`      |
| `factoryResetFlow`    | 2         | `flows/factoryReset.ts` |

### Standalone Wrappers

| Wrapper          | File              |
| ---------------- | ----------------- |
| `confirmAction`  | `confirm.ts`      |
| `promptText`     | `text.ts`         |
| `promptPassword` | `password.ts`     |
| `selectProfile`  | `profile.ts`      |
| `promptForAuth`  | `auth.ts`         |

### Shared Utilities

| Utility             | File              | Purpose                           |
| ------------------- | ----------------- | --------------------------------- |
| `handleCancel`      | `utils.ts`        | Exit on cancel (standalone use)   |
| `isCancel`          | `utils.ts`        | Named-arg wrapper for clack's isCancel |
| `unwrapPrompt`      | `flows/utils.ts`  | Cancel handling for flows         |
| `validateProfileName` | `validators.ts` | Profile name validation           |
| `validateOrgId`     | `validators.ts`   | Org ID validation                 |
| `validateRequired`  | `validators.ts`   | Non-empty validation              |

### Legacy System (to be removed)

`src/cli/prompt.ts` contains the old `promptUser` and `promptYesNo` functions.
Delete after all commands are migrated.

`src/cli/logger.ts` contains legacy output functions (`info`, `success`,
`error`, `raw`). Non-interactive commands should migrate to clack primitives.

---

## Migration TODO

### Completed Work

Documentation consolidation:

- [x] Delete `clack-prompts-PROGRESS.md` (outdated, conflicted with code)
- [x] Consolidate into single authoritative `clack-prompts-usage.md`
- [x] Document non-interactive output patterns (log.*, note, outro, stdout)
- [x] Document output ordering (note before outro)
- [x] Catalog all remaining commands for migration

Interactive flows migrated:

- [x] `flows/init.ts` - Full flow with 4 callbacks
- [x] `flows/login.ts` - Full flow with 1 callback
- [x] `flows/switchSkillset.ts` - Full flow with 4 callbacks
- [x] `flows/upload.ts` - Full flow with 2 callbacks
- [x] `flows/factoryReset.ts` - Full flow with 2 callbacks

Non-interactive commands migrated to clack output:

- [x] `logout/logout.ts` - `log.info()`, `log.success()`
- [x] `completion/completion.ts` - `process.stdout.write()`, `log.error()`
- [x] `dir/dir.ts` - `process.stdout.write()`, `log.success()`, `log.step()`
- [x] `new-skillset/newSkillset.ts` - `note()`, `outro()`, `log.error()`
- [x] `fork-skillset/forkSkillset.ts` - `note()`, `outro()`, `log.error()`
- [x] `list-skillsets/listSkillsets.ts` - `process.stdout.write()`, `log.error()`

### Command Migration (Interactive)

Commands with interactive prompts that need full flow migration:

- [ ] `login/login.ts` - Legacy path still uses `promptUser` (flow exists)
- [x] `watch/watch.ts` - Uses legacy `promptUser` for transcript destination (flow exists, `watchStopMain` also migrated)
- [ ] `install/existingConfigCapture.ts` - Legacy path (initFlow handles this)
- [ ] `registry-download/registryDownload.ts` - Multiple `promptUser` calls
- [ ] `registry-install/registryInstall.ts` - Interactive install prompts
- [ ] `registry-search/registrySearch.ts` - Search result selection
- [ ] `skill-download/skillDownload.ts` - Skill resolution prompts
- [ ] `switch-profile/profiles.ts` - Profile switching (flow exists, routing incomplete)
- [ ] `edit-skillset/editSkillset.ts` - Editor selection prompt
- [ ] `external/external.ts` - External skill installation prompts
- [ ] `install/install.ts` - Main installation flow
- [x] `factory-reset/factoryReset.ts` - Confirmation prompt (factoryResetFlow)

### Noninteractive Migration

Commands with legacy `info()`/`error()`/`raw()` output patterns:

- [ ] `install-location/installLocation.ts` - Simple output migration
- [ ] `registry-upload/registryUpload.ts` - Upload progress and results

### Final Cleanup

After all commands are migrated:

- [ ] Delete `src/cli/prompt.ts` (legacy `promptUser`, `promptYesNo`)
- [ ] Remove legacy output functions from `src/cli/logger.ts`
- [ ] Update tests to consistently mock `@clack/prompts`
