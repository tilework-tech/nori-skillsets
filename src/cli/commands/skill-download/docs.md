# Noridoc: skill-download

Path: @/src/cli/commands/skill-download

### Overview

The skill-download command downloads and installs individual skill packages from the Nori registry into the skills directories of all configured default agents. Unlike `registry-download` which handles entire skillsets, this command targets single skills.

### How it fits into the larger codebase

Registered as `download-skill` via `@/src/cli/commands/noriSkillsetsCommands.ts`. It uses the same `@/api/registrar.js` API (via `getSkillPackument` and `downloadSkillTarball`) but against skill-specific endpoints. Skills are installed to each configured default agent's skills directory and persisted to the active skillset's `skills/` subdirectory. Manifest updates go through both `addSkillDependency` (in the skillset's `skills/` resolver) and `addSkillToNoriJson` (from `@/norijson/nori.js`).

The command resolves default agents via `getDefaultAgents({ config })` from `@/src/cli/config.ts`, which automatically incorporates the global `--agent` flag override set by the CLI `preAction` hook (see @/src/cli/docs.md). It then iterates over all returned agents. This is the same multi-agent broadcasting pattern used by `switchSkillset` (@/src/cli/commands/switch-skillset/) and the external install command (@/src/cli/commands/external/).

The complete download, profile-manifest update, and live multi-agent copy run under the reentrant global transaction lock, preventing partial interleaving with activation, cleanup, config mutation, or another live download.

### Core Implementation

`skillDownloadMain` loads config **before** parsing the spec so a bare (non-namespaced) name can resolve against the configured `defaultOrg` via `parseNamespacedPackage` (from @/src/utils/url.ts) -- passed only when no explicit `--registry` was given, with `formatDefaultOrgNotice` logged when a bare name is routed to a non-public org. It then follows the same callback-driven flow pattern as registry-download. The `onSearch` callback supports namespaced packages (`org/skill-name`), explicit `--registry` URLs, and public registry fallback. For namespaced packages under unified auth, the org registry URL, membership check, and token acquisition come from `resolveOrgRegistryAuth` in @/src/core/registryAuthResolution.ts (shared with the other registry commands). Per-registry lookup uses `searchSpecificRegistry` from @/src/packaging/registryLookup.ts (with `registrarApi.getSkillPackument` and auth-token resolution injected as callbacks), and the same module's formatters produce the version-list and multiple-matches messages. Search errors from `searchSpecificRegistry` are swallowed at the call site, preserving the command's pre-refactor behavior. Existing installations are detected via `readVersionInfo` from @/src/packaging/provenance.ts with semver comparison to determine if an update is available.

The `onDownload` callback installs the tarball via the atomic-replacement primitives from @/src/packaging/atomicReplace.ts (`atomicReplaceDirWithArchive` for updates, `extractArchiveToNewDir` for fresh installs), writes `.nori-version` provenance via `writeVersionInfo`, copies the skill to the skillset's `skills/` directory for persistence, applies template substitution on `.md` files, and updates both the skill dependency manifest and `nori.json`.

**Multi-agent broadcasting**: After installing to the primary agent's skills directory and applying template substitution, the command copies the skill directory to each additional default agent's skills directory, re-applying template substitution with each agent's own `installDir` so that `{{skills_dir}}` and similar placeholders resolve to agent-specific paths. Copy failures for secondary agents emit warnings but do not fail the command.

### Things to Know

The `--skillset` flag lets the user target a specific skillset for manifest updates; otherwise it defaults to the active skillset from config. A user-supplied `--skillset` is resolved via `resolveUserSkillsetRef` from @/src/cli/skillsetResolution.ts (which resolves a bare name across the `personal/`/`public/` storage buckets and emits a one-time bare-name deprecation warning, suppressed under `--non-interactive`); the active-skillset fallback uses `resolveSkillsetDir` from @/src/norijson/skillset.ts (no warning). The command tracks the resolved directory (`targetSkillsetDir`) separately from the display name (`targetSkillset`) — persistence writes go to the resolved directory while messages show the name. Like registry-download, updates use the atomic swap with backup/restore on failure from @/src/packaging/atomicReplace.ts, and failed fresh installs clean up their partial directory. The `--registry` flag and namespace prefix (`org/`) are mutually exclusive since the namespace implicitly determines the registry URL. The `nonInteractive` and `silent` params are threaded from the CLI registration layer through `skillDownloadMain` to `skillDownloadFlow`, where they control whether the "Re-download from registry?" confirm prompt is skipped when the skill is already at the current version. The coercion `nonInteractive ?? silent ?? false` is applied so `--silent` implies non-interactive behavior.

Created and maintained by Nori.
