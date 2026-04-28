# Noridoc: prompts

Path: @/src/cli/prompts

### Overview

The prompts module provides a thin abstraction layer over the `@clack/prompts` library for consistent user input handling across the CLI. It exports atomic prompt primitives (confirm, text, password) with unified cancel behavior, input validators, and re-exports the higher-level interactive flows from `@/cli/prompts/flows`.

### How it fits into the larger codebase

Commands in `@/cli/commands` import from this module to collect user input. The atomic primitives (`confirmAction`, `promptText`, `promptPassword`) are used for simple one-off inputs, while the flow modules handle multi-step interactive experiences. The `index.ts` barrel file serves as the public API, re-exporting both the primitives and the flow modules so callers can import from `@/cli/prompts` directly.

### Core Implementation

Each prompt primitive wraps a corresponding `@clack/prompts` function, adding automatic cancel detection via `handleCancel` from `utils.ts`. When a user presses Ctrl+C, `handleCancel` calls `cancel()` to display a message, then `process.exit(0)` -- it never returns (typed as `never`).

`validators.ts` provides `validateSkillsetName`, which enforces a slug format: lowercase alphanumeric characters with hyphens, no leading/trailing hyphens, no consecutive hyphens. The validator returns `undefined` for valid input or an error message string, matching the `@clack/prompts` validation callback signature.

**Flow Modules (flows/):**
Flows provide complete interactive experiences that compose multiple prompts with visual feedback:
- `loginFlow` - Complete login UX with sequential email/password collection (two `unwrapPrompt`-wrapped clack calls; never `group()`), spinner during authentication, and note box for organization info. Returns `null` on cancellation so the caller can short-circuit. Intro/outro framing lives in the command registration layer, not in the flow itself
- `switchSkillsetFlow` - Multi-step skillset switching UX that broadcasts to all resolved agents (no agent selection prompt), with local change detection and handling (proceed/capture/abort), switch confirmation via note box, and spinner during switch and reinstall
- `uploadFlow` - Multi-step upload UX with version determination, upload attempt, and skill conflict resolution. Auto-resolves unchanged skills, then prompts for remaining conflicts with batch ("Resolve all the same way") or individual ("Choose one-by-one") resolution modes. The `link` action is presented as "Use Existing" for both unchanged and changed skills, with different hints (changed skills warn that local changes will be discarded — the sync layer then actually overwrites the local `SKILL.md` with the registry version). Returns `UploadFlowResult` with `linkedSkillVersions`, `linkedSubagentVersions`, `linkedSkillsToReplace`, `linkedSubagentsToReplace`, and `namespacedSkillIds`. See `flows/docs.md` for details
- `watchFlow` - Watch daemon startup UX with transcript destination org selection (auto-select for single org, `select()` prompt for multiple orgs), spinner during preparation and daemon spawning, and outro with PID/log file info. Uses 2 callbacks: `onPrepare` and `onStartDaemon`
- `promptSkillTypes` - Inline/extract type selection for external skills. Single skill gets a direct prompt; multiple skills use two-tier "all same" vs "one-by-one" pattern. Returns `Record<string, NoriJsonType>` or null on cancellation. Not re-exported through `flows/index.ts`

**Callback Pattern:**
Flows use a callbacks pattern to separate UI handling from business logic. The flow asks the user questions and returns a typed result; the caller supplies business logic (Firebase auth, API calls, config mutation) via a small `callbacks` object. For example, `loginFlow` accepts a single `onAuthenticate` callback. `switchSkillsetFlow` uses 4 coarse-grained callbacks (resolveAgents, prepareSwitchInfo, captureConfig, executeSwitch); `uploadFlow` uses 2 (onDetermineVersion, onUpload). See `flows/clack-prompts-usage.md` for guidelines on callback design and `flows/docs.md` for the full per-flow inventory.

### Things to Know

All prompt wrappers follow the same contract: they return the user's input value on success and call `process.exit(0)` on cancel. This means callers never need to handle cancellation explicitly when using these primitives -- the process terminates. The flow modules in `@/cli/prompts/flows` use a different pattern via `unwrapPrompt`, which returns `null` on cancel instead of exiting, allowing flows to handle cancellation gracefully.

Inside flows, `@clack/prompts`'s `group()` helper is forbidden. `group()` does not abort on Ctrl-C — it writes the literal string `"canceled"` into the result for the cancelled prompt and continues running subsequent prompts, so an outer `isCancel()` check on the returned object is always false. The canonical cancellation pattern is sequential `text` / `password` / `select` / `confirm` calls each wrapped in `unwrapPrompt`, with an early `return null` when the unwrapped value is null. See `flows/utils.ts` for the helper and `flows/clack-prompts-usage.md` for the rationale.

Created and maintained by Nori.
