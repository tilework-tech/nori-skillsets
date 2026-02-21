# Noridoc: registry-download

Path: @/src/cli/commands/registry-download

### Overview

The registry-download command downloads and installs skillset packages from the Nori registry. It handles version resolution, tarball extraction, skill dependency downloading, and skillset activation. This is the primary way users obtain skillsets from public or private registries.

### How it fits into the larger codebase

Registered via `@/src/cli/commands/noriSkillsetsCommands.ts` as the `download` command. It calls `@/cli/commands/init/init.js` to auto-initialize if no config exists. It searches registries using `@/api/registrar.js`, resolves auth tokens via `@/api/registryAuth.js`, and manages skillset metadata through `@/cli/features/claude-code/skillsets/`. Skill dependencies declared in a skillset's `nori.json` are recursively downloaded using the skill resolver at `@/cli/features/skillResolver.js`. The interactive search/download flow is driven by `@/cli/prompts/flows/` callbacks.

### Core Implementation

`registryDownloadMain` follows a callback-driven flow pattern using `registryDownloadFlow`. The `onSearch` callback resolves which registry to use (explicit `--registry`, namespaced `org/package`, or public fallback), fetches the packument, compares versions against any locally installed copy, and returns a status (`ready`, `already-current`, `list-versions`, or `error`). The `onDownload` callback fetches the tarball, extracts it (handling both gzip and plain tar), writes a `.nori-version` provenance file, and resolves skill dependencies from the skillset's `nori.json`.

Registry search supports three strategies: explicit registry URL, namespace-derived registry (via `buildOrganizationRegistryUrl`), and public registry. When no namespace or registry is specified and the user is authenticated, it searches all configured organization registries in parallel before falling back to public. Namespace packages that require auth but the user lacks access produce specific error messages.

### Things to Know

The download uses an atomic swap strategy for updates: extract to a temp directory, rename the existing directory to a backup, rename temp to target, then delete backup. If any step fails, it attempts to restore from backup. The `--list-versions` flag short-circuits the flow to display available versions without downloading. Auto-init is triggered when no config exists, passing `skipWarning: true` to suppress the interactive warning.

Created and maintained by Nori.
