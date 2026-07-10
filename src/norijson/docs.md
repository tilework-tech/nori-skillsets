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
- `resolveSkillsetDir()` and `skillsetCreateDir()` in `skillset.ts` are the shared read/create seams for the storage buckets. Read-path commands (switch, upload, install, skill/subagent download, skill-upload, import-mcp, unlink) and `agentOperations` (`switchSkillset`, `captureExistingConfig`) resolve a bare name across buckets via `resolveSkillsetDir`; create-path commands (`new`, `fork`, `external --new`, `link`) place a name via `skillsetCreateDir`. The **user-facing resolution edge** that turns a typed reference into a resolved dir + canonical identity (`resolveUserSkillsetRef`, `namespaceCreateSkillsetName`, `canonicalSkillsetName`, which apply `defaultOrg` and emit the bare-name deprecation warning) has been lifted out of this module into `@/src/cli/skillsetResolution.ts`, so `norijson` holds only the low-level path/discovery primitives it wraps. The write/download layout is chosen upstream in `@/src/utils/url.ts` (`namespacedName`).
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
- `skillsetPath({ name })`: Builds the expected absolute on-disk directory for a namespaced-or-bare name by splitting on `/` and joining under the profiles root. It does **not** check existence — it is the "expected location" fallback used when resolution finds nothing on disk. Reused by `resolveSkillsetDir`, `skillsetCreateDir`, and the not-found fallbacks in `switchSkillset`/`resolveRedownloadSource` that previously did raw `path.join(getNoriSkillsetsDir(), ...name.split("/"))`.
- `resolveSkillsetDir({ name })`: The **single read-resolution seam**. A name containing a slash is treated as an explicit namespace and resolved directly (`profiles/<ns>/<name>` via `skillsetPath`). A bare name is searched across buckets with precedence `personal/` -> `public/` -> legacy flat `profiles/<name>`; returns the resolved absolute path or `null`. A bare name equal to a reserved bucket name (`personal`/`public`) never resolves to the bucket root. Every command that reads/writes an existing local skillset routes its target through this function.
- `skillsetCreateDir({ name })`: Computes the on-disk directory for a *newly created* local skillset. Bare names land in `personal/`; explicitly namespaced names are written at that namespace unchanged (via `skillsetPath`). Used by `new`, `fork`, `external --new`, `captureExistingConfig`, and `link` (which first namespace a bare create name at the resolution edge — see `@/src/cli/skillsetResolution.ts`).
- `skillsetIdentity({ dir })`: The user-facing **namespaced identity** of a skillset directory — its path relative to `profiles/` (e.g. `personal/foo`, `public/foo`, `myorg/foo`, or a bare `foo` for a legacy flat profile). This is the single derivation of a directory's identity: `list`/`current` display it, and `switchSkillset`/`fork`/`new`/`register`/`external` all use it instead of hand-rolled `path.relative(getNoriSkillsetsDir(), dir)`.
- **User-facing name resolution moved out.** `resolveUserSkillsetRef`, `namespaceCreateSkillsetName`, and `canonicalSkillsetName` now live in `@/src/cli/skillsetResolution.ts` — they are the resolution *edge* (they apply `defaultOrg` and emit the bare-name deprecation warning) and belong above the commands, not among these low-level primitives. `norijson/skillset.ts` no longer imports config and never re-applies `defaultOrg`. See @/src/cli/docs.md.
- `parseSkillset({ skillsetName?, skillsetDir? })`: Resolves a skillset directory by routing `skillsetName` through `resolveSkillsetDir` (an unresolved bare name throws "not found" rather than falling back to a raw path that could hit a bucket root), calls `ensureNoriJson()`, reads metadata, probes for optional subdirectories/files. Checks for `AGENTS.md` first, then falls back to `CLAUDE.md` for backward compatibility.
- `listSkillsetsWithMetadata()`: Scans `~/.nori/profiles/` and returns each skillset under its **namespaced identity**. It uses a private pure `isSkillsetDir` predicate (a `nori.json` is present, or the directory passes `looksLikeSkillset` from `nori.ts`) -- listing is a read and never writes to profiles; it used to call `ensureNoriJson()` per entry, which mutated `~/.nori/profiles` on every list. The storage buckets (`personal/`, `public/`) and org namespaces are all treated the same way: a directory that is not itself a skillset is a namespace, and its children surface as `<namespace>/<child>` (so `personal/foo`, `public/foo`, `myorg/foo`); a skillset at the top level is a legacy flat profile and surfaces under its bare name. Uses `isDirentDirectory()` from `@/src/utils/dirent.ts` to follow symlinks, and reports `isLinked` via `entry.isSymbolicLink()` (a symlink at either the namespace level or the nested level counts as linked).
- `listSkillsets()`: Thin wrapper over `listSkillsetsWithMetadata()` that returns just the sorted name strings.

**Storage-bucket model:** Every non-org skillset historically lived flat at `profiles/<name>`. Skillsets are now sorted into storage buckets on disk, and the bucket is part of the **user-facing namespaced identity** shown by `list`/`current`: locally created skillsets are `personal/<name>` (`profiles/personal/<name>`), public-registrar skillsets are `public/<name>` (`profiles/public/<name>`), and organization skillsets are `<orgId>/<name>` (`profiles/<orgId>/<name>`, unchanged). A **bare** `<name>` remains a resolvable shorthand (so existing scripts using `sks switch foo` keep working) but is **deprecated** — user-facing commands emit a one-time warning via `resolveUserSkillsetRef` (in `@/src/cli/skillsetResolution.ts`) pointing at the namespaced identity. The *registrar reference* you type for `download`/`upload` may still be typed bare (`sks download foo`), but it is now displayed and stored fully qualified as `public/<name>` too — the earlier "public = bare" display convention has been retired, so public is `public/<name>` everywhere (see `namespacedName` in @/src/utils/docs.md).

| Origin | On-disk layout | User-facing identity |
|--------|----------------|----------------------|
| Locally created (`new`, `fork`, `external --new`, `init` capture, `link`) | `profiles/personal/<name>` | `personal/<name>` |
| Public registrar (download/publish) | `profiles/public/<name>` | `public/<name>` |
| Organization | `profiles/<orgId>/<name>` | `<orgId>/<name>` |
| Legacy flat (un-migrated) | `profiles/<name>` | bare `<name>` (deprecated) |

### Things to Know

- **Bucket invariant**: Every non-legacy skillset lives in a bucket (`personal/`, `public/`, or an org `<orgId>/`), and the bucket is part of the **user-facing namespaced identity**: `sks list`/`sks current` render `personal/foo`, `public/foo`, `<org>/foo`, and `activeSkillset` is persisted as that identity (via `canonicalSkillsetName` from @/src/cli/skillsetResolution.ts, called by `updateConfig` in @/src/cli/config.ts). A **bare** `foo` remains a resolvable shorthand for back-compat but is deprecated. Because `resolveSkillsetDir` re-resolves bare names across buckets (and the legacy flat location), older `activeSkillset` values and references never break when a profile is relocated. A one-time on-disk migration performs the relocation and rewrites a stored bare `activeSkillset` to its identity -- see @/src/cli/profilesMigration.ts.
- **System invariant**: `writeSkillsetMetadata` calls `normalizeMetadataForWrite` before serialization, which sorts list fields alphabetically (`skills` by name, `subagents` by name, `slashcommands` by command, `keywords` alphabetically, and `dependencies` object keys alphabetically). The `scripts` array is intentionally NOT sorted since script execution order may be meaningful. This is the single normalization point for all nori.json output — any future sortable fields should be added here.
- The `type` field distinguishes between full skillsets, standalone skills/subagents, and skills/subagents that were inlined from a skillset upload. `"inlined-skill"` and `"inlined-subagent"` types are set during the upload flow when the user chooses to keep a skill or subagent bundled in the skillset tarball rather than extracting it as an independent package. The `"subagent"` and `"inlined-subagent"` types mirror the skill types, giving subagents the same lifecycle as skills for upload, versioning, and registry distribution.
- `NoriJsonDependencies.subagents` maps subagent names to version ranges, mirroring the `skills` dependency map.
- `ensureNoriJson` uses the exported `looksLikeSkillset` heuristic: it checks for the presence of a known config file name (defaults to `["AGENTS.md", "CLAUDE.md"]`) or both `skills/` and `subagents/` subdirectories. This allows it to auto-generate manifests for user-created skillsets that predate the `nori.json` convention. Only mutation paths (`parseSkillset`, downloads, capture) call `ensureNoriJson`; read-only listing uses `looksLikeSkillset` directly so legacy skillsets are still discovered without gaining a `nori.json` as a side effect.
- `parseSkillset` checks for config files in priority order: `AGENTS.md` first, then `CLAUDE.md`. When both exist, `AGENTS.md` wins. New skillsets are created with `AGENTS.md`; `CLAUDE.md` is supported for backward compatibility with existing skillsets.
- Skillsets that bundle MCP servers (or any other env-dependent feature) may declare a `requiredEnv` array in `nori.json`. Entries are either plain strings or objects with `name`/`description`/`url`. The field is read by `checkRequiredEnv` at install time (see @/src/cli/features/envCheck.ts) and is auto-populated when running the `import-mcp` command (see @/src/cli/commands/import-mcp/docs.md).

Created and maintained by Nori.
