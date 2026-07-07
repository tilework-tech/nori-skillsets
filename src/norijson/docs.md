# Noridoc: norijson

Path: @/src/norijson

### Overview

- Type definitions and runtime operations for the `nori.json` manifest format -- the package descriptor used by both skillsets and individual skills in the Nori ecosystem.
- The `Skillset` type, parser, and discovery logic for resolving skillset directories from `~/.nori/profiles/`.
- The on-disk **storage-bucket model** and its single read-resolution seam (`resolveSkillsetDir`), which lets bare skillset names keep resolving after they are relocated into `personal/` / `public/` buckets.

### How it fits into the larger codebase

- `NoriJson` is consumed by CLI commands for skillset packaging (@/src/cli/commands/registry-upload/), downloading, and installation.
- The metadata CRUD functions (`readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `addSubagentToNoriJson`, `ensureNoriJson`) in `nori.ts` are called by CLI commands (fork, new, register, external, skill-download) and by `parseSkillset()` in `skillset.ts`.
- `parseSkillset()` in `skillset.ts` is called by `agentOperations.installSkillset()` in @/src/cli/features/agentOperations.ts to resolve the active skillset before running loaders.
- `listSkillsets()` and `listSkillsetsWithMetadata()` in `skillset.ts` are called by CLI commands (switch-skillset, list-skillsets, link-skillset, import-mcp) to discover installed skillsets. `listSkillsetsWithMetadata()` returns richer `SkillsetEntry` objects that include `isLinked` status, while `listSkillsets()` delegates to it and returns just names.
- `resolveSkillsetDir()` and `skillsetCreateDir()` in `skillset.ts` are the shared read/create seams for the storage buckets. Read-path commands (switch, upload, install, skill/subagent download, skill-upload, import-mcp) and `agentOperations` (`switchSkillset`, `captureExistingConfig`) resolve a bare name across buckets via `resolveSkillsetDir`; create-path commands (`new`, `fork`, `external --new`) place new skillsets via `skillsetCreateDir`. The write/download layout is chosen upstream in `@/src/utils/url.ts` (`namespacedOnDiskName`).
- `getNoriDir()` and `getNoriSkillsetsDir()` in `skillset.ts` provide the canonical paths (`~/.nori/` and `~/.nori/profiles/`) used throughout the CLI for skillset directory resolution.

```
CLI Commands (fork, new, register, switch, list, external, skill-download)
    |
    +-- nori.ts: readSkillsetMetadata / writeSkillsetMetadata / addSkillToNoriJson / addSubagentToNoriJson / ensureNoriJson
    |
    +-- skillset.ts: parseSkillset / listSkillsets / resolveSkillsetDir / skillsetCreateDir / getNoriDir / getNoriSkillsetsDir
            |
            +-- resolveSkillsetDir: bare name -> personal/ -> public/ -> legacy flat
            +-- calls ensureNoriJson / readSkillsetMetadata from nori.ts
```

### Core Implementation

**`nori.ts`** defines `NoriJson`, the unified manifest type. Key fields: `name`, `version` (required), `type` (one of `"skillset"`, `"skill"`, `"inlined-skill"`, `"subagent"`, `"inlined-subagent"`), and optional content arrays (`skills`, `subagents`, `slashcommands` for skillsets; `scripts` for skills). The `dependencies` field maps skill names and subagent names to version ranges. The type allows arbitrary additional fields via an index signature.

`nori.ts` also defines the skillset content types (`SkillsetSkill`, `SkillsetSubagent`, `SkillsetSlashCommand`) that describe discovered skillset components. `SkillsetSubagent` includes an optional `scripts` field for directory-based subagents that bundle scripts alongside their `SUBAGENT.md`. Runtime functions for `nori.json` file I/O:

| Function | Purpose |
|----------|---------|
| `readSkillsetMetadata` | Reads and parses `nori.json` from a skillset directory |
| `writeSkillsetMetadata` | Normalizes and writes `NoriJson` to `nori.json` in a skillset directory |
| `addSkillToNoriJson` | Adds/updates a skill dependency in `nori.json`, creating the file if missing |
| `addSubagentToNoriJson` | Adds/updates a subagent dependency in `nori.json`, creating the file if missing (mirrors `addSkillToNoriJson`) |
| `ensureNoriJson` | Backwards-compat shim: creates `nori.json` for legacy skillset dirs that have a config file or both `skills/` and `subagents/` subdirectories but no manifest |

**`skillset.ts`** provides path utilities, the `Skillset` type, the storage-bucket resolution seam, and discovery:

- `getNoriDir()` / `getNoriSkillsetsDir()`: Canonical path getters for `~/.nori/` and `~/.nori/profiles/`.
- `MANIFEST_FILE`: The constant `"nori.json"`, used to identify valid skillsets.
- `PERSONAL_BUCKET` (`"personal"`) / `PUBLIC_BUCKET` (`"public"`): Reserved storage-bucket directory names under `profiles/` (see the storage-bucket model below).
- `SkillsetEntry` type: Carries `name` and `isLinked` (whether the entry is a symlink) for each discovered skillset.
- `Skillset` type: Represents a parsed skillset directory with `name`, `dir`, `metadata` (the parsed `NoriJson`), and nullable paths for `skillsDir`, `configFilePath`, `slashcommandsDir`, `subagentsDir`, `mcpDir` (the optional `mcp/` subdirectory of canonical MCP server JSON files consumed by `createMcpLoader` in @/src/cli/features/shared/mcpLoader.ts).
- `resolveSkillsetDir({ name })`: The **single read-resolution seam**. A name containing a slash is treated as an explicit namespace and resolved directly (`profiles/<ns>/<name>`). A bare name is searched across buckets with precedence `personal/` -> `public/` -> legacy flat `profiles/<name>`; returns the resolved absolute path or `null`. Every command that reads/writes an existing local skillset routes its target through this function.
- `skillsetCreateDir({ name })`: Computes the on-disk directory for a *newly created* local skillset. Bare names land in `personal/`; explicitly namespaced names are written at that namespace unchanged. Used by `new`, `fork`, `external --new`, and `captureExistingConfig`.
- `parseSkillset({ skillsetName?, skillsetDir? })`: Resolves a skillset directory (routing `skillsetName` through `resolveSkillsetDir`, falling back to the legacy flat path when unresolved), calls `ensureNoriJson()`, reads metadata, probes for optional subdirectories/files. Checks for `AGENTS.md` first, then falls back to `CLAUDE.md` for backward compatibility.
- `listSkillsetsWithMetadata()`: Scans `~/.nori/profiles/`, supporting bucketed, flat, and org-namespaced layouts. The `personal/` and `public/` buckets are unwrapped so their children surface under **bare** names; org namespace directories (no top-level `nori.json`) surface their children as `<namespace>/<child>`; legacy flat skillsets surface as their bare name. Results are **deduped by name** (first entry wins) so a bare name present in both a bucket and the legacy flat location appears once. Uses `isDirentDirectory()` from `@/src/utils/dirent.ts` to follow symlinks, reports `isLinked` via `entry.isSymbolicLink()` (a symlink at either the namespace/bucket level or the nested level counts as linked), and calls `ensureNoriJson()` for backwards compatibility.
- `listSkillsets()`: Thin wrapper over `listSkillsetsWithMetadata()` that returns just the sorted name strings.

**Storage-bucket model:** Every non-org skillset historically lived flat at `profiles/<name>`. Skillsets are now sorted into invisible storage buckets on disk: locally created skillsets in `profiles/personal/<name>`, public-registrar skillsets in `profiles/public/<name>`. Organization skillsets are unchanged at `profiles/<orgId>/<name>`.

| Origin | On-disk layout | User-facing identity |
|--------|----------------|----------------------|
| Locally created (`new`, `fork`, `external --new`, `init` capture) | `profiles/personal/<name>` | bare `<name>` |
| Public registrar (download/publish) | `profiles/public/<name>` | bare `<name>` |
| Organization | `profiles/<orgId>/<name>` | namespaced `<orgId>/<name>` |

### Things to Know

- **Bucket invariant**: `personal/` and `public/` are *invisible storage buckets*, not user-facing namespaces. The user-facing identity for a personal/public skillset stays **bare** (`sks switch foo`, `sks list` shows `foo`, `activeSkillset: "foo"`); only org skillsets are addressed as `<orgId>/<name>`. Because `resolveSkillsetDir` re-resolves bare names across buckets (and the legacy flat location), existing `activeSkillset` config values and references never break when a profile is relocated. A one-time on-disk migration performs the relocation -- see `@/src/cli/profilesMigration.ts`.
- **System invariant**: `writeSkillsetMetadata` calls `normalizeMetadataForWrite` before serialization, which sorts list fields alphabetically (`skills` by name, `subagents` by name, `slashcommands` by command, `keywords` alphabetically, and `dependencies` object keys alphabetically). The `scripts` array is intentionally NOT sorted since script execution order may be meaningful. This is the single normalization point for all nori.json output — any future sortable fields should be added here.
- The `type` field distinguishes between full skillsets, standalone skills/subagents, and skills/subagents that were inlined from a skillset upload. `"inlined-skill"` and `"inlined-subagent"` types are set during the upload flow when the user chooses to keep a skill or subagent bundled in the skillset tarball rather than extracting it as an independent package. The `"subagent"` and `"inlined-subagent"` types mirror the skill types, giving subagents the same lifecycle as skills for upload, versioning, and registry distribution.
- `NoriJsonDependencies.subagents` maps subagent names to version ranges, mirroring the `skills` dependency map.
- `ensureNoriJson` uses a `looksLikeSkillset` heuristic: it checks for the presence of a known config file name (defaults to `["AGENTS.md", "CLAUDE.md"]`) or both `skills/` and `subagents/` subdirectories. This allows it to auto-generate manifests for user-created skillsets that predate the `nori.json` convention.
- `parseSkillset` checks for config files in priority order: `AGENTS.md` first, then `CLAUDE.md`. When both exist, `AGENTS.md` wins. New skillsets are created with `AGENTS.md`; `CLAUDE.md` is supported for backward compatibility with existing skillsets.
- Skillsets that bundle MCP servers (or any other env-dependent feature) may declare a `requiredEnv` array in `nori.json`. Entries are either plain strings or objects with `name`/`description`/`url`. The field is read by `checkRequiredEnv` at install time (see @/src/cli/features/envCheck.ts) and is auto-populated when running the `import-mcp` command (see @/src/cli/commands/import-mcp/docs.md).

Created and maintained by Nori.
