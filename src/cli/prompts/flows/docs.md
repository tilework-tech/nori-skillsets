# Noridoc: flows

Path: @/src/cli/prompts/flows

### Overview

- Complete interactive flow modules built on @clack/prompts that compose multiple prompts, spinners, notes, and intro/outro into cohesive CLI experiences
- Each flow uses a callbacks pattern to separate UI handling from business logic, making flows testable and reusable
- Provides loginFlow (authentication), switchSkillsetFlow (skillset switching with local change detection), initFlow (initialization with optional existing config capture), factoryResetFlow (artifact discovery and confirmed deletion), newSkillsetFlow (interactive skillset creation with metadata collection), registerSkillsetFlow (metadata collection for existing skillset registration), uploadFlow (profile upload with skill conflict resolution), watchFlow (watch daemon startup with transcript destination selection), configFlow (default agents selection and install directory configuration), listVersionsFlow, and promptSkillTypes (inline/extract type selection for external skills)
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
- The configFlow is consumed by the config command (@/cli/commands/config/config.ts) to select default agents and install directory
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

- **configFlow:** Two-step flow that selects default agents via `multiselect()` (allowing multiple agent selection) and an install directory via `text()`. Accepts 2 callbacks: `onLoadConfig` (returns `currentAgents: Array<string> | null` to populate defaults from existing config) and `onResolveAgents` (to get available agents from the registry). Returns `{ defaultAgents: Array<string>, installDir }` on success or null on cancel. Does not call `outro()` — the command handles success messaging after `saveConfig()` succeeds.
- **promptSkillTypes** (`externalSkillType.ts`): Prompts the user to choose whether each skill should be inlined (bundled in skillset tarball, type `"inlined-skill"`) or extracted (independent package, type `"skill"`). Uses a two-tier pattern matching the upload flow's conflict resolution: single skill gets a direct inline/extract prompt; multiple skills first ask "Resolve all the same way" vs "Choose one-by-one", then the actual inline/extract choice. No callbacks — stateless prompt-only function. Returns `Record<string, NoriJsonType>` or null on cancellation. Not re-exported through `flows/index.ts`; imported directly by the external command.
- **newSkillsetFlow:** Collects metadata for new skillset creation using @clack/prompts `group()` with six fields: name (required, validated with `validateSkillsetName` allowing namespaced names like org/name), description, license, keywords (comma-separated string parsed to array), version, and repository URL. Returns typed result object with all fields or null on cancellation. No callbacks pattern — flow is stateless metadata collection only. Keywords parsing via `parseKeywords()` splits on comma, trims whitespace, and returns null for empty input.
- **registerSkillsetFlow:** Collects metadata for registering an existing skillset using @clack/prompts `group()` with five fields: description, license, keywords (comma-separated string parsed to array), version, and repository URL. All fields are optional. Returns typed result object with all fields or null on cancellation. No callbacks pattern — flow is stateless metadata collection only. Keywords parsing via `parseKeywords()` splits on comma, trims whitespace, and returns null for empty input. Unlike newSkillsetFlow, this flow does not collect the name field since it's derived from the folder path when registering an existing skillset.
- **uploadFlow:** Multi-step upload flow that handles version determination, upload attempt, and skill conflict resolution. Accepts 3 callbacks: `onDetermineVersion`, `onUpload`, and `onReadLocalSkillMd` (optional, reads local SKILL.md content for diff viewing). Conflict resolution uses a two-tier strategy:
  1. **Auto-resolution:** Conflicts where `contentUnchanged === true` and `link` is an available action are automatically resolved as "link" (Use Existing) without prompting.
  2. **Interactive resolution:** Remaining (unresolved) conflicts are presented to the user. When multiple unresolved conflicts exist, the user chooses between "Resolve all the same way" (batch mode via `resolveAllConflictsSameWay`) or "Choose one-by-one" (individual mode via `resolveConflictsInFlow`). A single unresolved conflict goes straight to individual resolution.
  3. **View Diff:** When a conflict has changed content and the server provides `existingSkillMd`, a "View Diff" option appears in the resolution prompt. Selecting it reads the local SKILL.md via the `onReadLocalSkillMd` callback, computes a line-by-line diff using the `diff` npm package (`diffLines`), displays colored +/- output via `note()`, and re-prompts the same conflict. The diff is truncated at 50 lines. "viewDiff" is a local-only pseudo-action (`ConflictSelectAction` type) that never reaches the server — it is handled entirely within the `resolveConflictsInFlow` while-loop.

  The `link` action is presented as "Use Existing" for both unchanged and changed skills. For unchanged skills, the hint shows the linked version. For changed skills, the hint warns that local changes will be discarded. The flow tracks linked, namespaced, and skipped skill IDs separately and returns them in `UploadFlowResult`. The summary note categorizes skills into Uploaded, Linked (existing), Namespaced, Skipped, and Failed sections. Supports a `nonInteractive` flag that blocks upload and displays an error note when unresolvable conflicts exist.

### Things to Know

- `promptSkillTypes` is not re-exported through `flows/index.ts` — it is imported directly by the external command at @/src/cli/commands/external/external.ts
- The `unwrapPrompt` utility in `utils.ts` is the standard way to handle cancellation in flows — it wraps `isCancel` + `cancel` into a single call that returns `T | null`
- The switchSkillsetFlow's buildChangesSummary helper truncates file lists to 5 entries per category (modified/added/deleted) with a "... and N more" overflow message
- When a flow returns null, the command should treat it as a clean cancellation — the flow has already displayed the appropriate cancel message to the user
- The interactive mode gate (`!nonInteractive`) lives in the command handler, not in the flow itself. Flows have no awareness of feature flags
- In the uploadFlow, batch resolution via `buildCommonResolutionOptions` only offers actions that are available across ALL unresolved conflicts (set intersection). When `updateVersion` is selected in batch mode, each skill automatically receives its own suggested next patch version via `getSuggestedVersion` without individual version prompts
- The uploadFlow's View Diff option requires three conditions: (1) the server's 409 response included `existingSkillMd` in the conflict, (2) `contentUnchanged` is false, and (3) the `onReadLocalSkillMd` callback was provided. The `existingSkillMd` field flows from `SkillConflictInfo` in @/src/utils/fetch.ts through `SkillConflict` in @/src/api/registrar.ts into the upload flow. The registry-upload command (@/src/cli/commands/registry-upload/registryUpload.ts) wires the callback to read `{profileDir}/skills/{skillId}/SKILL.md` via `fs.readFile`
- See `clack-prompts-usage.md` in this directory for the full guide on building new flows

Created and maintained by Nori.
