# Noridoc: prompts

Path: @/src/cli/prompts

### Overview

The prompts module provides a thin abstraction layer over the `@clack/prompts` library for consistent user input handling across the CLI. It exports atomic prompt primitives (confirm, text, password) with unified cancel behavior, input validators, and re-exports the higher-level interactive flows from `@/cli/prompts/flows`.

### How it fits into the larger codebase

Commands in `@/cli/commands` import from this module to collect user input. The atomic primitives (`confirmAction`, `promptText`, `promptPassword`) are used for simple one-off inputs, while the flow modules handle multi-step interactive experiences. The `index.ts` barrel file serves as the public API, re-exporting both the primitives and the flow modules so callers can import from `@/cli/prompts` directly.

### Core Implementation

Each prompt primitive wraps a corresponding `@clack/prompts` function, adding automatic cancel detection via `handleCancel` from `utils.ts`. When a user presses Ctrl+C, `handleCancel` calls `cancel()` to display a message, then `process.exit(0)` -- it never returns (typed as `never`).

`validators.ts` provides `validateSkillsetName`, which enforces a slug format: lowercase alphanumeric characters with hyphens, no leading/trailing hyphens, no consecutive hyphens. The validator returns `undefined` for valid input or an error message string, matching the `@clack/prompts` validation callback signature.

### Things to Know

All prompt wrappers follow the same contract: they return the user's input value on success and call `process.exit(0)` on cancel. This means callers never need to handle cancellation explicitly when using these primitives -- the process terminates. The flow modules in `@/cli/prompts/flows` use a different pattern via `unwrapPrompt`, which returns `null` on cancel instead of exiting, allowing flows to handle cancellation gracefully.

Created and maintained by Nori.
