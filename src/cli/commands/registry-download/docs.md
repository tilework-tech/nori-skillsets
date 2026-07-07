# Noridoc: registry-download

Path: @/src/cli/commands/registry-download

### Overview

The registry-download command downloads and installs skillset packages from the Nori registry. It handles version resolution, tarball extraction, skill and subagent dependency downloading, and skillset activation. This is the primary way users obtain skillsets from public or private registries.

### How it fits into the larger codebase

Registered via `@/src/cli/commands/noriSkillsetsCommands.ts` as the `download` command. It calls `@/cli/commands/init/init.js` to auto-initialize if no config exists. It searches registries using `@/api/registrar.js` (including `getSubagentPackument` and `downloadSubagentTarball` for subagent deps), resolves auth tokens via `@/api/registryAuth.js`, and manages skillset metadata through `@/norijson/nori.js`. Skill and subagent dependencies declared in a skillset's `nori.json` are downloaded inline via `downloadSkillDependencies` and `downloadSubagentDependencies`. The interactive search/download flow is driven by `@/cli/prompts/flows/` callbacks.

### Core Implementation

`registryDownloadMain` loads config **before** parsing the spec so a bare (non-namespaced) name can resolve against the configured `defaultOrg` via `parseNamespacedPackage` (from @/src/utils/url.ts); the `defaultOrg` is passed only when no explicit `--registry` was given, and when a bare name is thereby routed to a non-public org the command logs `formatDefaultOrgNotice` so the redirect is visible. It then follows a callback-driven flow pattern using `registryDownloadFlow`. The `onSearch` callback resolves which registry to use from the parsed orgId (explicit `--registry`, resolved `org/package`, or the public registrar), fetches the packument, compares versions against any locally installed copy, and returns a status (`ready`, `already-current`, `list-versions`, or `error`). The `onDownload` callback fetches the tarball, extracts it (handling both gzip and plain tar), writes a `.nori-version` provenance file, and resolves both skill and subagent dependencies from the skillset's `nori.json`.

Registry search branches on the resolved orgId: an explicit `--registry` URL is queried directly; a resolved orgId of `"public"` queries only the public registrar; and a resolved org (from an `org/` namespace or from the configured `defaultOrg`) queries that single organization registry via `buildOrganizationRegistryUrl`. The user must belong to that org, and a bare name routed through `defaultOrg` resolves to exactly that one registry with no public fallback on a miss (dependency-confusion safety). Namespace/org packages that require auth the user lacks produce specific error messages.

### Things to Know

The download uses an atomic swap strategy for updates: extract to a temp directory, rename the existing directory to a backup, rename temp to target, then delete backup. If any step fails, it attempts to restore from backup. The same atomic swap pattern is used for both skill and subagent dependency downloads (`downloadSkillDependency` and `downloadSubagentDependency`). Both dependency downloaders check `.nori-version` for version comparison and skip re-download when already at latest version. The `--list-versions` flag short-circuits the flow to display available versions without downloading. Auto-init is triggered when no config exists, passing `skipWarning: true` to suppress the interactive warning. The `nonInteractive` and `silent` params are threaded from the CLI registration layer through `registryDownloadMain` to both the `initMain` call (which previously hardcoded `nonInteractive: false`) and to `registryDownloadFlow` where they control whether interactive prompts (e.g., "Re-download from registry?") are skipped. The coercion `nonInteractive ?? silent ?? false` is applied at these boundaries so that `--silent` implies non-interactive behavior.

Subagent dependencies are downloaded by `downloadSubagentDependencies`, which reads `noriJson.dependencies.subagents` and downloads each via `registrarApi.getSubagentPackument` and `registrarApi.downloadSubagentTarball`. All three download paths (fresh download, update download, and "already-current" re-download) call both `downloadSkillDependencies` and `downloadSubagentDependencies`. During profile updates, the `onDownload` callback preserves existing `skills/` and `subagents/` directories -- extracted files in those directories from the tarball are discarded so that dependency-managed content is not overwritten by stale tarball content.

Created and maintained by Nori.
