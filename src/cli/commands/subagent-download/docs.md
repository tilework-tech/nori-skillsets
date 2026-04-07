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
- Multi-agent broadcasting uses the same pattern as `skill-download`: after installing to the primary agent, the flattened `.md` file is copied to each additional default agent's agents directory.

### Core Implementation

`subagentDownloadMain` follows the two-phase callback-driven flow pattern (search then download). The `onSearch` callback supports namespaced packages (`org/subagent-name`), explicit `--registry` URLs, and public registry fallback. It checks for existing installations via `.nori-version` files and uses semver comparison to determine if an update is available.

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

The `onDownload` callback handles both new installs and updates. Updates use an atomic swap pattern: extract to temp dir, rename existing to backup, rename temp to target, then clean up backup. If the swap fails, the backup is restored.

### Things to Know

- The `--skillset` flag targets a specific skillset for `nori.json` updates; otherwise it defaults to the active skillset from config. When no skillset is available, the subagent is still installed to the agents directory but without profile persistence.
- The `--registry` flag and namespace prefix (`org/`) are mutually exclusive since the namespace implicitly determines the registry URL via `buildOrganizationRegistryUrl()`.
- The `nonInteractive` and `silent` params are threaded from the CLI registration layer to `subagentDownloadFlow`, where they control whether the "Re-download from registry?" confirm prompt is skipped when the subagent is already at the current version.
- The `.nori-version` file written to the subagent directory tracks `version`, `registryUrl`, and `orgId` for provenance.
- Copy failures for secondary agents emit warnings but do not fail the command.

Created and maintained by Nori.
