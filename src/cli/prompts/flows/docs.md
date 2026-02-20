# Noridoc: flows

Path: @/src/cli/prompts/flows

### Overview

The flows module contains complete multi-step interactive experiences for each major CLI operation. Each flow is a pure presentation layer: it orchestrates `@clack/prompts` UI elements (intro, outro, spinners, notes, confirms, selects) and delegates all side effects to injected callback functions. This callback-injection pattern makes every flow independently testable without mocking the prompt library.

### How it fits into the larger codebase

Commands in `@/cli/commands` instantiate flow functions and supply callbacks that call into `@/cli/features` and `@/api` for business logic. Flows never directly access the filesystem, network, or config -- they receive everything they need through their callback interfaces. The `index.ts` barrel re-exports all flows and their associated types so consumers can import from `@/cli/prompts/flows` or `@/cli/prompts`.

### Core Implementation

Every flow function follows the same structural pattern:

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

`switchSkillsetFlow` has a three-way local change handling step: proceed (discard changes), capture (save as new skillset first), or abort. This is the only flow that detects and responds to uncommitted local modifications.

`uploadFlow` handles skill conflict resolution in a two-pass pattern. If the first upload attempt returns conflicts, it prompts for resolution strategy (link, namespace, or per-skill), then retries the upload with the chosen strategy.

Created and maintained by Nori.
