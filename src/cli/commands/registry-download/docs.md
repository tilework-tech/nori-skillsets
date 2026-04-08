# Noridoc: registry-download

Path: @/src/cli/commands/registry-download

### Overview

The registry-download command downloads and installs skillset packages from the Nori registry. It handles version resolution, tarball extraction, skill and subagent dependency downloading, and skillset activation. This is the primary way users obtain skillsets from public or private registries.

### How it fits into the larger codebase

Registered via `@/src/cli/commands/noriSkillsetsCommands.ts` as the `download` command. It calls `@/cli/commands/init/init.js` to auto-initialize if no config exists. It searches registries using `@/api/registrar.js` (including `getSubagentPackument` and `downloadSubagentTarball` for subagent deps), resolves auth tokens via `@/api/registryAuth.js`, and manages skillset metadata through `@/norijson/nori.js`. Skill and subagent dependencies declared in a skillset's `nori.json` are downloaded inline via `downloadSkillDependencies` and `downloadSubagentDependencies`. The interactive search/download flow is driven by `@/cli/prompts/flows/` callbacks.

### Core Implementation

`registryDownloadMain` follows a callback-driven flow pattern using `registryDownloadFlow`. The `onSearch` callback resolves which registry to use (explicit `--registry`, namespaced `org/package`, or public fallback), fetches the packument, compares versions against any locally installed copy, and returns a status (`ready`, `already-current`, `list-versions`, or `error`). The `onDownload` callback fetches the tarball, extracts it (handling both gzip and plain tar), writes a `.nori-version` provenance file, and resolves both skill and subagent dependencies from the skillset's `nori.json`.

Registry search supports three strategies: explicit registry URL, namespace-derived registry (via `buildOrganizationRegistryUrl`), and public registry. When no namespace or registry is specified and the user is authenticated, it searches all configured organization registries in parallel before falling back to public. Namespace packages that require auth but the user lacks access produce specific error messages.

### Things to Know

The download uses an atomic swap strategy for updates: extract to a temp directory, rename the existing directory to a backup, rename temp to target, then delete backup. If any step fails, it attempts to restore from backup. The same atomic swap pattern is used for both skill and subagent dependency downloads (`downloadSkillDependency` and `downloadSubagentDependency`). Both dependency downloaders check `.nori-version` for version comparison and skip re-download when already at latest version. The `--list-versions` flag short-circuits the flow to display available versions without downloading. Auto-init is triggered when no config exists, passing `skipWarning: true` to suppress the interactive warning. The `nonInteractive` and `silent` params are threaded from the CLI registration layer through `registryDownloadMain` to both the `initMain` call (which previously hardcoded `nonInteractive: false`) and to `registryDownloadFlow` where they control whether interactive prompts (e.g., "Re-download from registry?") are skipped. The coercion `nonInteractive ?? silent ?? false` is applied at these boundaries so that `--silent` implies non-interactive behavior.

Subagent dependencies are downloaded by `downloadSubagentDependencies`, which reads `noriJson.dependencies.subagents` and downloads each via `registrarApi.getSubagentPackument` and `registrarApi.downloadSubagentTarball`. All three download paths (fresh download, update download, and "already-current" re-download) call both `downloadSkillDependencies` and `downloadSubagentDependencies`. During profile updates, the `onDownload` callback preserves existing `skills/` and `subagents/` directories -- extracted files in those directories from the tarball are discarded so that dependency-managed content is not overwritten by stale tarball content.

Created and maintained by Nori.
