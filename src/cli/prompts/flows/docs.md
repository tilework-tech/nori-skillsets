# Noridoc: flows

Path: @/src/cli/prompts/flows

### Overview

The flows module contains complete multi-step interactive experiences for each major CLI operation. Each flow is a pure presentation layer: it orchestrates `@clack/prompts` UI elements (intro, outro, spinners, notes, confirms, selects) and delegates all side effects to injected callback functions. This callback-injection pattern makes every flow independently testable without mocking the prompt library.

### How it fits into the larger codebase

Commands in `@/cli/commands` instantiate flow functions and supply callbacks that call into `@/cli/features` and `@/api` for business logic. Flows never directly access the filesystem, network, or config -- they receive everything they need through their callback interfaces. The `index.ts` barrel re-exports all flows and their associated types so consumers can import from `@/cli/prompts/flows` or `@/cli/prompts`.

### Core Implementation

Every flow function follows the same structural pattern:

- **Callback pattern:** Each flow accepts a callbacks object containing async functions for all side-effectful operations (API calls, file I/O, config mutations). The flow itself only handles UI. Callbacks should be coarse-grained (1-4 per flow). This makes flows fully testable by injecting mock callbacks.
- **Return convention:** Flows return a typed result object on success or null on cancellation/abort. The flow handles displaying cancel messages internally via `unwrapPrompt` or @clack/prompts cancel().
- **Cancel handling:** The `unwrapPrompt<T>()` utility in `utils.ts` wraps clack's `isCancel` check -- returns `T` if not cancelled, `null` if cancelled (after displaying the cancel message). Flows use this instead of inline cancel boilerplate.
- **loginFlow:** Collects email/password credentials via `group()`, runs authentication via a single callback, displays organization info in a note box, and returns the auth result.
- **switchSkillsetFlow:** Multi-step flow that broadcasts the switch to all resolved agents (no agent selection prompt). Resolves all agents via `onResolveAgents`, prepares switch info for ALL agents (detects local changes + gets current skillset), handles local changes (proceed/capture/abort), shows switch details in a note, confirms with the user, then executes the switch via spinner. The flow aggregates `ManifestDiff` results from all agents when detecting local changes: it merges the `modified`, `added`, and `deleted` arrays from each agent into a combined diff. If any agent reports changes, the user sees the aggregated changes. The confirmation note shows all agent names (comma-separated if multiple). Accepts 4 callbacks: `onResolveAgents`, `onPrepareSwitchInfo`, `onCaptureConfig`, `onExecuteSwitch`. Both `onPrepareSwitchInfo` and `onExecuteSwitch` are called once per agent in a loop.
- **initFlow:** Multi-step initialization flow that checks for parent Nori installations, detects existing agent config, optionally captures existing config as a skillset, shows persistence warnings, and performs initialization. Accepts 4 callbacks: `onCheckAncestors`, `onDetectExistingConfig`, `onCaptureConfig`, `onInit`. The existingConfigCapture prompt is integrated into the flow rather than delegated to legacy modules. Persistence warnings use note() + confirm() instead of legacy "type yes" text prompts. All display strings in the init flow are agent-agnostic: `buildExistingConfigSummary` uses `config.configFileName` from the `ExistingConfig` object (returned by `onDetectExistingConfig`) instead of hardcoding any agent-specific file name, and the ancestor warning text refers generically to "AI coding agents" rather than a specific agent.
- **factoryResetFlow:** Two-step flow that discovers configuration artifacts via `onFindArtifacts` callback, displays them in a note, requires the user to type "confirm" for safety, then deletes via `onDeleteArtifacts` callback. Accepts 2 callbacks. Returns `{ deletedCount }` on success or null on cancel/decline. The intro includes the agent display name (e.g., "Factory Reset Claude Code").
- **watchFlow:** Watch daemon startup flow that prepares the environment (stops existing daemon, loads config), selects a transcript destination organization, and spawns the daemon. Accepts 2 callbacks: `onPrepare` (returns available orgs, current destination, running state) and `onStartDaemon` (saves config and spawns daemon process). If only one private org is available, auto-selects it. If multiple orgs are available, prompts the user with `select()`. If `forceSelection` is set, bypasses reuse of the current destination. Returns null on cancellation or when no private orgs exist.

1. Accept an args object containing configuration, an install directory, and a `callbacks` object with typed async functions
2. Display an `intro()` header
3. Walk through steps using spinners, prompts, and notes
4. Call callbacks for side-effectful work (authentication, file I/O, API calls)
5. Display an `outro()` footer
6. Return a typed result object on success, or `null` on cancel/failure

`unwrapPrompt` in `utils.ts` is the shared cancel-handling helper. Unlike the atomic prompts in the parent module (which call `process.exit`), `unwrapPrompt` returns `null` on cancel, allowing flows to propagate cancellation upward.

The flows cover the full lifecycle of skillset management:

| Flow | Purpose |
|------|---------|
| `loginFlow` | Email/password collection and authentication |
| `initFlow` | First-time initialization with config capture |
| `switchSkillsetFlow` | Switch active skillset with local change detection |
| `uploadFlow` | Version determination, skill conflict resolution, and upload |
| `registryDownloadFlow` | Search, version comparison, and skillset download |
| `skillDownloadFlow` | Search and download for individual skills |
| `registrySearchFlow` | Search the registry for skillsets and skills |
| `listVersionsFlow` | Display available versions of a package |
| `newSkillsetFlow` | Collect metadata for a new skillset |
| `registerSkillsetFlow` | Collect metadata for an existing skillset (no name prompt) |
| `factoryResetFlow` | Discover and delete agent configuration artifacts |
| `watchFlow` | Start the transcript watch daemon with org selection |
| `configFlow` | Configure default agents and install directory |
| `promptSkillTypes` | Choose inline vs extract for discovered skills from external repos |

### Things to Know

The callback-injection pattern is a deliberate architectural choice. Flows are tested by providing mock callbacks that return predetermined results, while the prompt UI itself is verified through the typed return values. This means flow tests validate the decision logic (e.g., "if search returns already-current, show the right message") without needing to simulate terminal input.

`switchSkillsetFlow` has a three-way local change handling step: proceed (discard changes), capture (save as new skillset first), or abort. This is the only flow that detects and responds to uncommitted local modifications. The flow aggregates local changes from ALL default agents: it calls `onPrepareSwitchInfo` for each agent in sequence, merges the resulting `ManifestDiff` objects by concatenating their arrays, and displays the combined changes to the user. This ensures that changes in any agent's managed files trigger the change-handling flow. The aggregation happens in a simple loop that builds up the combined diff incrementally.

`uploadFlow` handles skill conflict resolution in a two-pass pattern. If the first upload attempt returns conflicts, it prompts for resolution strategy (link, namespace, or per-skill), then retries the upload with the chosen strategy.

Created and maintained by Nori.
