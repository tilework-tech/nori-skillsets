# Noridoc: flows

Path: @/src/cli/prompts/flows

### Overview

- Complete interactive flow modules built on @clack/prompts that compose multiple prompts, spinners, notes, and intro/outro into cohesive CLI experiences
- Each flow uses a callbacks pattern to separate UI handling from business logic, making flows testable and reusable
- Currently provides loginFlow (authentication), switchSkillsetFlow (skillset switching with local change detection), initFlow (initialization with optional existing config capture), and newSkillsetFlow (interactive skillset creation with metadata collection)
- The `clack-prompts-usage.md` file in this directory documents prescriptive patterns for building new flows

### How it fits into the larger codebase

- CLI commands in @/cli/commands/ import flows to handle multi-step interactive sequences instead of managing prompt logic inline
- Flows use @clack/prompts primitives directly (intro, outro, select, confirm, text, spinner, note, cancel) rather than going through the individual prompt wrappers in the parent @/cli/prompts/ directory
- Flows use `unwrapPrompt` from `utils.ts` for cancel handling instead of repeating inline `isCancel` + `cancel` + `return null` at each prompt step
- Flows use text formatting helpers from @/cli/logger.js (`bold`, `green`, `brightCyan`) for styled text inside clack `note()` boxes
- Flows are re-exported through @/cli/prompts/flows/index.ts and again through @/cli/prompts/index.ts so commands can import from either level
- The switchSkillsetFlow is consumed by the switch-profile command (@/cli/commands/switch-profile/profiles.ts) when the --experimental-ui flag is active
- The initFlow is consumed by the init command (@/cli/commands/init/init.ts) when the --experimental-ui flag is active
- The newSkillsetFlow is consumed by the new command (@/cli/commands/new-skillset/newSkillset.ts) to collect metadata interactively
- Validators from @/cli/prompts/validators.ts are used within flows for input validation (e.g., validateProfileName in switchSkillsetFlow)

### Core Implementation

- **Callback pattern:** Each flow accepts a callbacks object containing async functions for all side-effectful operations (API calls, file I/O, config mutations). The flow itself only handles UI. Callbacks should be coarse-grained (1-4 per flow). This makes flows fully testable by injecting mock callbacks.
- **Return convention:** Flows return a typed result object on success or null on cancellation/abort. The flow handles displaying cancel messages internally via `unwrapPrompt` or @clack/prompts cancel().
- **Cancel handling:** The `unwrapPrompt<T>()` utility in `utils.ts` wraps clack's `isCancel` check — returns `T` if not cancelled, `null` if cancelled (after displaying the cancel message). Flows use this instead of inline cancel boilerplate.
- **loginFlow:** Collects email/password credentials via `group()`, runs authentication via a single callback, displays organization info in a note box, and returns the auth result.
- **switchSkillsetFlow:** Multi-step flow that resolves which agent to switch, prepares switch info (detects local changes + gets current profile), handles local changes (proceed/capture/abort), shows switch details in a note, confirms with the user, then executes the switch via spinner. Accepts 4 callbacks: `onResolveAgents`, `onPrepareSwitchInfo`, `onCaptureConfig`, `onExecuteSwitch`.
- **initFlow:** Multi-step initialization flow that checks for parent Nori installations, detects existing Claude Code config, optionally captures existing config as a profile, shows persistence warnings, and performs initialization. Accepts 4 callbacks: `onCheckAncestors`, `onDetectExistingConfig`, `onCaptureConfig`, `onInit`. The existingConfigCapture prompt is integrated into the flow rather than delegated to legacy modules. Persistence warnings use note() + confirm() instead of legacy "type yes" text prompts.

- **newSkillsetFlow:** Collects metadata for new skillset creation using @clack/prompts `group()` with six fields: name (required, validated with `validateSkillsetName` allowing namespaced names like org/name), description, license, keywords (comma-separated string parsed to array), version, and repository URL. Returns typed result object with all fields or null on cancellation. No callbacks pattern — flow is stateless metadata collection only. Keywords parsing via `parseKeywords()` splits on comma, trims whitespace, and returns null for empty input.
### Things to Know

- The `unwrapPrompt` utility in `utils.ts` is the standard way to handle cancellation in flows — it wraps `isCancel` + `cancel` into a single call that returns `T | null`
- The switchSkillsetFlow's buildChangesSummary helper truncates file lists to 5 entries per category (modified/added/deleted) with a "... and N more" overflow message
- When a flow returns null, the command should treat it as a clean cancellation — the flow has already displayed the appropriate cancel message to the user
- The experimental UI gate (`experimentalUi && !nonInteractive`) lives in the command handler, not in the flow itself. Flows have no awareness of feature flags
- See `clack-prompts-usage.md` in this directory for the full guide on building new flows

Created and maintained by Nori.
