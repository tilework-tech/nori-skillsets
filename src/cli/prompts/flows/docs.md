# Noridoc: flows

Path: @/src/cli/prompts/flows

### Overview

The flows module contains complete multi-step interactive experiences for each major CLI operation. Each flow is a pure presentation layer: it orchestrates `@clack/prompts` UI elements (spinners, notes, confirms, selects) and delegates all side effects to injected callback functions. Flows do not call `intro()` or `outro()` -- visual framing is the responsibility of the top-level command caller. This callback-injection pattern makes every flow independently testable without mocking the prompt library.

### How it fits into the larger codebase

Commands in `@/cli/commands` instantiate flow functions and supply callbacks that call into `@/cli/features` and `@/api` for business logic. Flows never directly access the filesystem, network, or config -- they receive everything they need through their callback interfaces. The `index.ts` barrel re-exports all flows and their associated types so consumers can import from `@/cli/prompts/flows` or `@/cli/prompts`.

### Core Implementation

Every flow function follows the same structural pattern:

- **Callback pattern:** Each flow accepts a callbacks object containing async functions for all side-effectful operations (API calls, file I/O, config mutations). The flow itself only handles UI. Callbacks should be coarse-grained (1-4 per flow). This makes flows fully testable by injecting mock callbacks.
- **Return convention:** Flows return a typed result object on success (including a `statusMessage` string field) or null on cancellation/abort. The `statusMessage` carries the message that the top-level caller can display (e.g., via `outro()`). The flow handles displaying cancel messages internally via `unwrapPrompt` or @clack/prompts cancel().
- **Cancel handling:** The `unwrapPrompt<T>()` utility in `utils.ts` wraps clack's `isCancel` check -- returns `T` if not cancelled, `null` if cancelled (after displaying the cancel message). Flows use this instead of inline cancel boilerplate.
- **loginFlow:** Collects email/password credentials via `group()`, runs authentication via a single callback, displays organization info in a note box, and returns the auth result.
- **switchSkillsetFlow:** Multi-step flow that broadcasts the switch to all resolved agents (no agent selection prompt). Resolves all agents via `onResolveAgents`, prepares switch info for ALL agents (detects local changes + gets current skillset), handles local changes (proceed/capture/view changes/abort), shows switch details in a note, confirms with the user, then executes the switch via spinner. The flow aggregates `ManifestDiff` results from all agents when detecting local changes: it merges the `modified`, `added`, and `deleted` arrays from each agent into a combined diff. If any agent reports changes, the user sees the aggregated changes. The confirmation note shows all agent names (comma-separated if multiple). Accepts 4 required callbacks (`onResolveAgents`, `onPrepareSwitchInfo`, `onCaptureConfig`, `onExecuteSwitch`) and 2 optional callbacks (`onRedownload`, `onReadFileDiff`). Both `onPrepareSwitchInfo` and `onExecuteSwitch` are called once per agent in a loop. When `onRedownload` is provided (non-null), the flow calls it unconditionally after the user confirms the switch but before execution -- no additional confirm prompt is shown. The download flow (`registryDownloadFlow`) owns the redownload UX and handles its own "already-current" prompt when the local version matches the registry version. When `onReadFileDiff` is provided and modified files exist, a "View changes" option appears in the change-handling select. Selecting it shows a file picker (or auto-selects if only one modified file), calls `onReadFileDiff` to get original+current content, and displays a colored unified diff via `formatDiffForNote` from `diffFormat.ts`. The change-handling select runs in a while loop so users can view multiple diffs before choosing proceed/capture/abort.
- **initFlow:** Multi-step initialization flow that checks for parent Nori installations, detects existing agent config, optionally captures existing config as a skillset, shows persistence warnings, and performs initialization. Accepts 4 callbacks: `onCheckAncestors`, `onDetectExistingConfig`, `onCaptureConfig`, `onInit`. The existingConfigCapture prompt is integrated into the flow rather than delegated to legacy modules. Persistence warnings use note() + confirm() instead of legacy "type yes" text prompts. All display strings in the init flow are agent-agnostic: `buildExistingConfigSummary` uses `config.configFileName` from the `ExistingConfig` object (returned by `onDetectExistingConfig`) instead of hardcoding any agent-specific file name, and the ancestor warning text refers generically to "AI coding agents" rather than a specific agent.
- **factoryResetFlow:** Two-step flow that discovers configuration artifacts via `onFindArtifacts` callback, displays them in a note, requires the user to type "confirm" for safety, then deletes via `onDeleteArtifacts` callback. Accepts 2 callbacks. Returns `{ deletedCount, statusMessage }` on success or null on cancel/decline. The `agentName` parameter is accepted for API compatibility but not displayed by the flow.
- **watchFlow:** Watch daemon startup flow that prepares the environment (stops existing daemon, loads config), selects a transcript destination organization, and spawns the daemon. Accepts 2 callbacks: `onPrepare` (returns available orgs, current destination, running state) and `onStartDaemon` (saves config and spawns daemon process). If only one private org is available, auto-selects it. If multiple orgs are available, prompts the user with `select()`. If `forceSelection` is set, bypasses reuse of the current destination. Returns null on user cancellation. Returns a result with `statusMessage` for informational exits (no private orgs, daemon failure) and success.
- **registryDownloadFlow / skillDownloadFlow:** Two-phase download flows (search then download) that share the same structure. Both accept `onSearch` and `onDownload` callbacks, plus an optional `nonInteractive` param. When `onSearch` returns `"already-current"` status and `nonInteractive` is true, the flow skips the confirm prompt entirely and returns `{ isUpdate: false, statusMessage: "Already up to date" }`. When `nonInteractive` is false or unset, the flow prompts the user with a `confirm()` to re-download from the registry (defaulting to No). If the user confirms, the flow falls through to the download phase with a "Re-downloading..." spinner message. If the user declines, it returns `{ isUpdate: false }`. If the user cancels (Ctrl+C), the flow returns `null` via `unwrapPrompt`. The `"already-current"` path also displays any skill dependency warnings before showing the confirm prompt.

1. Accept an args object containing configuration, an install directory, and a `callbacks` object with typed async functions
2. Walk through steps using spinners, prompts, and notes
3. Call callbacks for side-effectful work (authentication, file I/O, API calls)
4. Return a typed result object (with `statusMessage`) on success, or `null` on cancel/failure

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
| `configFlow` | Configure default agents, install directory, and redownload-on-switch toggle |
| `promptSkillTypes` | Choose inline vs extract for discovered skills from external repos |

### Things to Know

The callback-injection pattern is a deliberate architectural choice. Flows are tested by providing mock callbacks that return predetermined results, while the prompt UI itself is verified through the typed return values. This means flow tests validate the decision logic (e.g., "if search returns already-current, show the right message") without needing to simulate terminal input.

`switchSkillsetFlow` has a four-way local change handling step: proceed (discard changes), capture (save as new skillset first), view changes (see content diffs), or abort. The "View changes" option only appears when modified files exist AND the `onReadFileDiff` callback is provided. This is the only flow that detects and responds to uncommitted local modifications. The flow aggregates local changes from ALL default agents: it calls `onPrepareSwitchInfo` for each agent in sequence, merges the resulting `ManifestDiff` objects by concatenating their arrays, and displays the combined changes to the user. This ensures that changes in any agent's managed files trigger the change-handling flow. The aggregation happens in a simple loop that builds up the combined diff incrementally.

`formatDiffForNote` in `diffFormat.ts` is a shared utility used by both `switchSkillsetFlow` (viewing local changes) and `uploadFlow` (skill conflict resolution). It uses the `diff` package's `diffLines` function and ANSI color helpers (`green`/`red` from `@/cli/logger.js`) to produce colored unified diff output for terminal display in `@clack/prompts` note boxes.

`registryDownloadFlow` and `skillDownloadFlow` allow re-downloading packages even when the local version matches the registry version. This supports the case where registry contents change without a version bump (e.g., updated skill dependencies). The confirm prompt defaults to `false` to preserve the previous behavior of skipping the download when already current. Both flows accept a `nonInteractive` param; when true, the "already-current" path returns immediately with "Already up to date" instead of prompting. This supports CI/automated workflows where interactive prompts would block execution.

`uploadFlow` handles skill conflict resolution in a two-pass pattern. If the first upload attempt returns conflicts, it prompts for resolution strategy (link, namespace, or per-skill), then retries the upload with the chosen strategy. When a skill is resolved as "link" (use existing remote version), the flow captures both the skill ID and the remote's `latestVersion` in a `linkedSkillVersions: Map<string, string>` on the `UploadFlowResult`. This allows the caller to sync the linked version back to the local `nori.json` `dependencies.skills` so local state stays consistent with the registry. Auto-resolved links (where `contentUnchanged` is true) and user-chosen links both populate this map.

Created and maintained by Nori.
