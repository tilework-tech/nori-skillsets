# Noridoc: prompts

Path: @/src/cli/prompts

### Overview

- Provides consistent interactive prompt wrappers built on @clack/prompts for the CLI
- Individual wrappers for text, password, confirm, and select prompts with unified cancel handling
- Flow modules that compose prompts into complete interactive experiences with intro/outro messages, spinners, and notes

### How it fits into the larger codebase

- CLI commands import from @/cli/prompts/index.ts to access individual prompt functions (promptText, confirmAction, etc.) for simple cases
- Complex interactive sequences use flow modules (e.g., loginFlow) which handle all user-facing output (intro, spinner, notes, outro) so commands don't duplicate this
- All prompt wrappers use handleCancel() from utils.ts to provide consistent cancellation behavior (displays message via @clack/prompts cancel() and exits with code 0)
- The validators.ts module provides validation functions used by prompts (validateProfileName, validateOrgId, validateRequired)

### Core Implementation

**Individual Prompt Wrappers:**
- `promptText` - Text input with optional placeholder, default value, initial value, and validation
- `promptPassword` - Masked password input
- `confirmAction` - Yes/no confirmation with optional initial value
- `selectProfile` - Profile selection from a list with name/description/hint display
- `promptForAuth` - Grouped email/password/org prompt using @clack/prompts group()

**Flow Modules (flows/):**
Flows provide complete interactive experiences that compose multiple prompts with visual feedback:
- `loginFlow` - Complete login UX with grouped email/password collection, spinner during authentication, note box for organization info, and outro message. Supports `skipIntro` to allow callers to manage the intro message externally (e.g., when loginFlow is used as a sub-flow after an auth method selection prompt)
- `switchSkillsetFlow` - Multi-step skillset switching UX with agent selection, local change detection and handling (proceed/capture/abort), switch confirmation via note box, and spinner during switch and reinstall
- `watchFlow` - Watch daemon startup UX with transcript destination org selection (auto-select for single org, `select()` prompt for multiple orgs), spinner during preparation and daemon spawning, and outro with PID/log file info. Uses 2 callbacks: `onPrepare` and `onStartDaemon`

**Callback Pattern:**
Flows use a callbacks pattern to separate UI handling from business logic:
```typescript
loginFlow({
  skipIntro: true,
  callbacks: {
    onAuthenticate: async ({ email, password }) => AuthenticateResult
  }
})
```
This allows commands to provide business logic (Firebase auth, API calls, config mutation) while the flow handles all UI details. The switchSkillsetFlow uses 4 coarse-grained callbacks (resolveAgents, prepareSwitchInfo, captureConfig, executeSwitch). See `flows/clack-prompts-usage.md` for guidelines on callback design.

### Things to Know

- `handleCancel()` never returns - it calls `process.exit(0)` after displaying the cancel message
- `isCancel({ value })` wraps @clack/prompts isCancel to match the codebase's named args pattern
- Flow modules return null on cancellation or failure (the flow handles displaying error UI)
- The `ValidateFunction` type in text.ts follows the pattern `(args: { value: string }) => string | undefined` where undefined means valid and a string is the error message
- `promptForAuth()` returns null if user enters empty email, allowing auth to be skipped during interactive flows
- Flow modules (loginFlow, switchSkillsetFlow, watchFlow, and their associated types) are exported both from flows/index.ts and re-exported from prompts/index.ts for convenient access
- Flows use `unwrapPrompt` from flows/utils.ts for cancel handling; standalone wrappers use `handleCancel` which calls `process.exit(0)` — these are separate patterns for separate use cases
- Flows return null on cancellation; the command should treat null as a clean exit since the flow has already displayed cancel UI to the user

Created and maintained by Nori.
