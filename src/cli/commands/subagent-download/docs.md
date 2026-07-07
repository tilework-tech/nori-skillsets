# Noridoc: subagent-download

Path: @/src/cli/commands/subagent-download

### Overview

The subagent-download command downloads and installs individual subagent packages from the Nori registry into the agents directories of all configured default agents. This mirrors the `skill-download` command (@/src/cli/commands/skill-download/) but targets subagent packages instead of skills.

### How it fits into the larger codebase

- Registered as `download-subagent` via `@/src/cli/commands/noriSkillsetsCommands.ts` with `wrapWithFraming` for intro/outro framing.
- Uses `registrarApi.getSubagentPackument()` and `registrarApi.downloadSubagentTarball()` from `@/api/registrar.js` for registry interactions.
- Subagent dependencies are tracked in `nori.json` via `addSubagentToNoriJson()` from `@/norijson/nori.js`. There is no `skills.json` equivalent for subagents.
- Full subagent directory structures are persisted under the skillset profile at `~/.nori/profiles/<skillset>/subagents/<name>/`.
- The UX flow is delegated to `subagentDownloadFlow` from `@/cli/prompts/flows/subagentDownload.js`, following the same callback-injection pattern as all other flows.
- Package mechanics come from the shared primitives in @/src/packaging/: per-registry search and message formatting from `registryLookup.ts`, atomic install/update from `atomicReplace.ts`, and `.nori-version` provenance from `provenance.ts`. Search errors from `searchSpecificRegistry` are swallowed at the call site, preserving pre-refactor behavior.
- Multi-agent broadcasting uses the same pattern as `skill-download`: after installing to the primary agent, the flattened `.md` file is copied to each additional default agent's agents directory. Default agents are resolved via `getDefaultAgents({ config })`, which automatically incorporates the global `--agent` flag override set by the CLI `preAction` hook (see @/src/cli/docs.md).

### Core Implementation

`subagentDownloadMain` loads config **before** parsing the spec so a bare (non-namespaced) name can resolve against the configured `defaultOrg` via `parseNamespacedPackage` (from @/src/utils/url.ts) -- passed only when no explicit `--registry` was given, with `formatDefaultOrgNotice` logged when a bare name is routed to a non-public org. It then follows the two-phase callback-driven flow pattern (search then download). The `onSearch` callback supports namespaced packages (`org/subagent-name`), explicit `--registry` URLs, and public registry fallback. It checks for existing installations via `.nori-version` files and uses semver comparison to determine if an update is available.

**Flattening** is the key difference from skill-download. Subagent tarballs contain a full directory structure (including `SUBAGENT.md`), but agent installation flattens this: only the `SUBAGENT.md` content is written to `agents/<name>.md` after template substitution via `substituteTemplatePaths()`. The full directory is preserved in the skillset profile for round-tripping.

```
Registry tarball
    |
    +-- extracts to ~/.nori/profiles/<skillset>/subagents/<name>/  (full directory)
    |
    +-- flattenSubagentToAgentDir()
            |
            +-- reads SUBAGENT.md from extracted directory
            +-- applies substituteTemplatePaths()
            +-- writes agents/<name>.md to each agent's agents/ dir
```

The `onDownload` callback handles both new installs and updates. Updates use `atomicReplaceDirWithArchive` and fresh installs use `extractArchiveToNewDir`, both from @/src/packaging/atomicReplace.ts — a failed swap restores the backup, and a failed fresh install removes the partial directory.

### Things to Know

- The `--skillset` flag targets a specific skillset for `nori.json` updates; otherwise it defaults to the active skillset from config. When no skillset is available, the subagent is still installed to the agents directory but without profile persistence.
- The `--registry` flag and namespace prefix (`org/`) are mutually exclusive since the namespace implicitly determines the registry URL. Under unified auth, that URL plus the org-membership check and token acquisition come from `resolveOrgRegistryAuth` in @/src/core/registryAuthResolution.ts (shared with the other registry commands).
- The `nonInteractive` and `silent` params are threaded from the CLI registration layer to `subagentDownloadFlow`, where they control whether the "Re-download from registry?" confirm prompt is skipped when the subagent is already at the current version.
- The `.nori-version` file written to the subagent directory tracks `version`, `registryUrl`, and `orgId` for provenance.
- Copy failures for secondary agents emit warnings but do not fail the command.

Created and maintained by Nori.
