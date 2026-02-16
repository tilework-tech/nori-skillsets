# Noridoc: flows

Path: @/src/cli/prompts/flows

### Overview

- Complete interactive flow modules built on @clack/prompts that compose multiple prompts, spinners, notes, and intro/outro into cohesive CLI experiences
- Each flow uses a callbacks pattern to separate UI handling from business logic, making flows testable and reusable
- Provides loginFlow (authentication), switchSkillsetFlow (skillset switching with local change detection), initFlow (initialization with optional existing config capture), factoryResetFlow (artifact discovery and confirmed deletion), newSkillsetFlow (interactive skillset creation with metadata collection), registerSkillsetFlow (metadata collection for existing skillset registration), uploadFlow (profile upload with skill conflict resolution), watchFlow (watch daemon startup with transcript destination selection), and listVersionsFlow
- The `clack-prompts-usage.md` file in this directory documents prescriptive patterns for building new flows

### How it fits into the larger codebase

- CLI commands in @/cli/commands/ import flows to handle multi-step interactive sequences instead of managing prompt logic inline
- Flows use @clack/prompts primitives directly (intro, outro, select, confirm, text, spinner, note, cancel) rather than going through the individual prompt wrappers in the parent @/cli/prompts/ directory
- Flows use `unwrapPrompt` from `utils.ts` for cancel handling instead of repeating inline `isCancel` + `cancel` + `return null` at each prompt step
- Flows use text formatting helpers from @/cli/logger.js (`bold`, `green`, `brightCyan`) for styled text inside clack `note()` boxes
- Flows are re-exported through @/cli/prompts/flows/index.ts and again through @/cli/prompts/index.ts so commands can import from either level
- The switchSkillsetFlow is consumed by the switch-profile command (@/cli/commands/switch-profile/profiles.ts) in interactive mode
- The initFlow is consumed by the init command (@/cli/commands/init/init.ts) in interactive mode
- The factoryResetFlow is consumed by the factory-reset command (@/cli/commands/factory-reset/factoryReset.ts) in interactive mode
- The newSkillsetFlow is consumed by the new command (@/cli/commands/new-skillset/newSkillset.ts) to collect metadata interactively
- The registerSkillsetFlow is consumed by the register command (@/cli/commands/register-skillset/registerSkillset.ts) to collect metadata for existing skillsets
- The uploadFlow is consumed by the registry-upload command (@/cli/commands/registry-upload/registryUpload.ts) to handle the complete upload UX including skill conflict resolution
- Validators from @/cli/prompts/validators.ts are used within flows for input validation (e.g., validateProfileName in switchSkillsetFlow)

### Core Implementation

- **Callback pattern:** Each flow accepts a callbacks object containing async functions for all side-effectful operations (API calls, file I/O, config mutations). The flow itself only handles UI. Callbacks should be coarse-grained (1-4 per flow). This makes flows fully testable by injecting mock callbacks.
- **Return convention:** Flows return a typed result object on success or null on cancellation/abort. The flow handles displaying cancel messages internally via `unwrapPrompt` or @clack/prompts cancel().
- **Cancel handling:** The `unwrapPrompt<T>()` utility in `utils.ts` wraps clack's `isCancel` check — returns `T` if not cancelled, `null` if cancelled (after displaying the cancel message). Flows use this instead of inline cancel boilerplate.
- **loginFlow:** Collects email/password credentials via `group()`, runs authentication via a single callback, displays organization info in a note box, and returns the auth result.
- **switchSkillsetFlow:** Multi-step flow that resolves which agent to switch, prepares switch info (detects local changes + gets current profile), handles local changes (proceed/capture/abort), shows switch details in a note, confirms with the user, then executes the switch via spinner. Accepts 4 callbacks: `onResolveAgents`, `onPrepareSwitchInfo`, `onCaptureConfig`, `onExecuteSwitch`.
- **initFlow:** Multi-step initialization flow that checks for parent Nori installations, detects existing Claude Code config, optionally captures existing config as a profile, shows persistence warnings, and performs initialization. Accepts 4 callbacks: `onCheckAncestors`, `onDetectExistingConfig`, `onCaptureConfig`, `onInit`. The existingConfigCapture prompt is integrated into the flow rather than delegated to legacy modules. Persistence warnings use note() + confirm() instead of legacy "type yes" text prompts.
- **factoryResetFlow:** Two-step flow that discovers configuration artifacts via `onFindArtifacts` callback, displays them in a note, requires the user to type "confirm" for safety, then deletes via `onDeleteArtifacts` callback. Accepts 2 callbacks. Returns `{ deletedCount }` on success or null on cancel/decline. The intro includes the agent display name (e.g., "Factory Reset Claude Code").
- **watchFlow:** Watch daemon startup flow that prepares the environment (stops existing daemon, loads config), selects a transcript destination organization, and spawns the daemon. Accepts 2 callbacks: `onPrepare` (returns available orgs, current destination, running state) and `onStartDaemon` (saves config and spawns daemon process). If only one private org is available, auto-selects it. If multiple orgs are available, prompts the user with `select()`. If `forceSelection` is set, bypasses reuse of the current destination. Returns null on cancellation or when no private orgs exist.

- **newSkillsetFlow:** Collects metadata for new skillset creation using @clack/prompts `group()` with six fields: name (required, validated with `validateSkillsetName` allowing namespaced names like org/name), description, license, keywords (comma-separated string parsed to array), version, and repository URL. Returns typed result object with all fields or null on cancellation. No callbacks pattern — flow is stateless metadata collection only. Keywords parsing via `parseKeywords()` splits on comma, trims whitespace, and returns null for empty input.
- **registerSkillsetFlow:** Collects metadata for registering an existing skillset using @clack/prompts `group()` with five fields: description, license, keywords (comma-separated string parsed to array), version, and repository URL. All fields are optional. Returns typed result object with all fields or null on cancellation. No callbacks pattern — flow is stateless metadata collection only. Keywords parsing via `parseKeywords()` splits on comma, trims whitespace, and returns null for empty input. Unlike newSkillsetFlow, this flow does not collect the name field since it's derived from the folder path when registering an existing skillset.
- **uploadFlow:** Multi-step upload flow that handles version determination, upload attempt, and skill conflict resolution. Accepts 2 callbacks: `onDetermineVersion` and `onUpload`. Conflict resolution uses a two-tier strategy:
  1. **Auto-resolution:** Conflicts where `contentUnchanged === true` and `link` is an available action are automatically resolved as "link" (Use Existing) without prompting.
  2. **Interactive resolution:** Remaining (unresolved) conflicts are presented to the user. When multiple unresolved conflicts exist, the user chooses between "Resolve all the same way" (batch mode via `resolveAllConflictsSameWay`) or "Choose one-by-one" (individual mode via `resolveConflictsInFlow`). A single unresolved conflict goes straight to individual resolution.

  The `link` action is presented differently depending on content status: "Use Existing" for unchanged skills, "Skip Upload" for changed skills (keeps the skill in the manifest at its current version without uploading). The flow tracks linked, namespaced, and skipped skill IDs separately and returns them in `UploadFlowResult`. The summary note categorizes skills into Uploaded, Linked (existing), Namespaced, Skipped, and Failed sections. Supports a `nonInteractive` flag that blocks upload and displays an error note when unresolvable conflicts exist.

### Things to Know

- The `unwrapPrompt` utility in `utils.ts` is the standard way to handle cancellation in flows — it wraps `isCancel` + `cancel` into a single call that returns `T | null`
- The switchSkillsetFlow's buildChangesSummary helper truncates file lists to 5 entries per category (modified/added/deleted) with a "... and N more" overflow message
- When a flow returns null, the command should treat it as a clean cancellation — the flow has already displayed the appropriate cancel message to the user
- The interactive mode gate (`!nonInteractive`) lives in the command handler, not in the flow itself. Flows have no awareness of feature flags
- The uploadFlow contains parallel resolution logic in both `upload.ts` (flow-based, uses `unwrapPrompt`) and @/cli/prompts/skillResolution.ts (standalone, uses `handleCancel` + `process.exit`). Both modules share the same `link` action dual-presentation pattern ("Use Existing" vs "Skip Upload") based on `contentUnchanged`, but they are independent implementations
- In the uploadFlow, batch resolution via `buildCommonResolutionOptions` only offers actions that are available across ALL unresolved conflicts (set intersection). When `updateVersion` is selected in batch mode, each skill automatically receives its own suggested next patch version via `getSuggestedVersion` without individual version prompts
- See `clack-prompts-usage.md` in this directory for the full guide on building new flows

Created and maintained by Nori.
