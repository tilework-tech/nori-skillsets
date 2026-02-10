# Clack Prompts Usage Guide

Rules for building interactive CLI flows using `@clack/prompts`.

---

## Flow File Structure

Every flow is a single exported async function in `src/cli/prompts/flows/`.
The function does five things in order:

1. `intro()` — title for the flow
2. Prompts — collect user input
3. Callbacks with spinners — execute side effects
4. `note()` / `log.*` — display results
5. `outro()` — closing message

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

### Use a shared `unwrap` helper for individual prompts

When prompts are sequential and conditional (cannot use `group`), use this
pattern instead of repeating `isCancel` + `cancel` + `return null`:

```ts
// src/cli/prompts/flows/utils.ts
import { isCancel, cancel } from "@clack/prompts";

export const unwrapPrompt = <T>(args: {
  value: T | symbol;
  cancelMessage?: string | null;
}): T | null => {
  const { value, cancelMessage } = args;
  if (isCancel(value)) {
    cancel(cancelMessage ?? "Operation cancelled.");
    return null;
  }
  return value as T;
};
```

Usage in a flow:

```ts
const selected = unwrapPrompt({
  value: await select({ message: "Pick one", options }),
  cancelMessage: "Switch cancelled.",
});
if (selected == null) return null;
```

### Never do this

Do not repeat cancel boilerplate inline at every prompt:

```ts
// BAD — verbose, duplicated at every step
if (isCancel(result)) {
  cancel("Skillset switch cancelled.");
  return null;
}
```

## Callbacks

### Keep the callback surface small

A flow should have 1-3 callbacks. Each callback represents a coarse operation
the caller is responsible for. The flow asks the user questions; the caller
does the work.

```ts
// GOOD — one callback for the whole auth operation
type LoginFlowCallbacks = {
  onAuthenticate: (args: { email: string; password: string }) =>
    Promise<AuthenticateResult>;
};
```

```ts
// BAD — flow micro-manages steps that are the caller's concern
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
combine them into one callback. The flow does not care about internal steps —
it just needs a spinner around the whole thing.

### Use discriminated unions for failable callbacks

If a callback can fail, return a discriminated union. This lets the flow
control error UX without try/catch:

```ts
type AuthenticateResult =
  | { success: true; userEmail: string; /* ... */ }
  | { success: false; error: string; hint?: string | null };
```

The flow checks `result.success` and uses `log.error()` / `note()` for
error display. No try/catch in the flow body.

## Styling and Formatting

### No inline ANSI escape codes

Do not define local ANSI helper functions in flow files. The project already
has color/formatting helpers in `@/cli/logger.ts` (`boldWhite`, `brightCyan`,
`gray`). Use those when you need formatted text inside a `note()`. Prefer
clack primitives (`note`, `log.*`, `intro`, `outro`) for visual hierarchy.

```ts
// BAD — inline ANSI helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
note(`Current: ${bold(name)}`, "Details");

// GOOD — use existing logger helpers
import { boldWhite } from "@/cli/logger.js";
note(`Current: ${boldWhite({ text: name })}`, "Details");
```

### Use `note()` for information blocks

Use `note(content, title)` to display multi-line structured information
before a prompt (e.g. switch details, detected changes).

### Use `log.error()` for errors, `log.warn()` for warnings

Do not use `note()` for errors. Use `log.error()` for the main error message
and optionally `note()` for a hint or additional context.

## Data Formatting Helpers

If a flow needs to format a data structure for display (e.g. a list of changed
files), extract it into a helper function in the same file or a shared utility.
Keep it short. If truncation logic is needed (show first N, then "and X more"),
write a generic `truncateList` utility rather than inlining it per-flow.

## Flow vs Standalone Prompt Wrappers

- **Standalone wrappers** (`promptText`, `confirmAction`, etc. in
  `src/cli/prompts/`) call `handleCancel()` which does `process.exit(0)`.
  Use these for one-off prompts in commands that don't need graceful flow control.
- **Flows** return `null` on cancel. They never call `process.exit`.
  Flows must not import or use the standalone wrappers.

## Testing Flows

Mock `@clack/prompts` entirely. Provide mock callbacks. Assert:

1. Which clack functions were called and with what arguments
2. Which callbacks were called and with what arguments
3. The return value (result object or null)

Do not test clack's internal behavior. Test that the flow calls the right
prompts in the right order and passes the right data to callbacks.
