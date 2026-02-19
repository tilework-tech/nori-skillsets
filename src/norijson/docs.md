# Noridoc: norijson

Path: @/src/norijson

### Overview

- Shared TypeScript type definitions used across the codebase
- Contains the canonical `NoriJson` manifest type that matches the nori-registrar repo's definition
- Defines `SkillsetPackage` -- the in-memory representation of a loaded skillset -- and the `loadSkillsetPackage()` function that reads a profile directory into it

### How it fits into the larger codebase

- `NoriJson` (@/src/norijson/nori.ts) is the single source of truth for the nori.json manifest shape, imported directly by CLI commands that create or read nori.json files (e.g., `new-skillset`, `register-skillset`, `registry-download`)
- `SkillsetSkill`, `SkillsetSubagent`, `SkillsetSlashCommand` (@/src/norijson/skillset.ts) define the inlined content types that appear as fields within `NoriJson`. These represent content discovered from a skillset directory (skill directories, subagent .md files, slash command .md files)
- `SkillsetPackage` (@/src/norijson/packageStructure.ts) is the type contract consumed by all profile loaders in @/src/cli/features/claude-code/profiles/. The profiles orchestrator calls `loadSkillsetPackage()` once and passes the result to each sub-loader, so loaders never touch the filesystem for profile content themselves
- `loadSkillsetPackage()` (@/src/norijson/packageStructure.ts) is the single place that understands the profile directory structure on disk. Adding a new component to a skillset means adding a field to `SkillsetPackage` -- TypeScript then flags every loader that needs updating
- The `NoriJson` type is aligned with the canonical definition in the nori-registrar repository to prevent type drift between the two codebases

### Core Implementation

**NoriJson** (@/src/norijson/nori.ts): The unified manifest type for both skillsets and skills. Required fields are `name` and `version`. Optional fields include:

| Field | Type | Purpose |
|-------|------|---------|
| `author` | `string` | Package author |
| `description` | `string` | Human-readable description |
| `license` | `string` | SPDX license identifier |
| `keywords` | `Array<string>` | Registry discoverability |
| `repository` | `string` | Repository URL (plain string, not an object) |
| `dependencies` | `NoriJsonDependencies` | Skill/subagent/slash command version ranges |
| `skills` | `Array<SkillsetSkill>` | Inlined skill content for skillsets |
| `subagents` | `Array<SkillsetSubagent>` | Inlined subagent content for skillsets |
| `slashcommands` | `Array<SkillsetSlashCommand>` | Inlined slash command content for skillsets |
| `scripts` | `Array<string>` | Script filenames for skills |
| `type` | `NoriJsonType` | Package type: `"skillset"`, `"skill"`, or `"inlined-skill"` |
| `registryURL` | `string` | Server-set metadata |

The type includes an index signature (`[key: string]: unknown`) to allow additional fields without breaking type checks.

**NoriJsonDependencies** (@/src/norijson/nori.ts): The dependencies section maps dependency names to semver version ranges. Supports `skills`, `subagents`, and `slashCommands` (the latter two are reserved for future use).

**Skillset content types** (@/src/norijson/skillset.ts): `SkillsetSkill`, `SkillsetSubagent`, and `SkillsetSlashCommand` represent content discovered from a skillset directory structure. These are used as top-level array fields in `NoriJson` when publishing to the registry.

**SkillsetPackage and loadSkillsetPackage** (@/src/norijson/packageStructure.ts): `SkillsetPackage` is the in-memory representation of everything a skillset contains after being read from disk. It has four fields:

| Field | Type | Source |
|-------|------|--------|
| `claudeMd` | `string \| null` | `CLAUDE.md` in profile root |
| `skills` | `Array<SkillEntry>` | Subdirectories of `skills/` (non-directory entries filtered out) |
| `subagents` | `Array<MdFileEntry>` | `.md` files in `subagents/` (excluding `docs.md`) |
| `slashcommands` | `Array<MdFileEntry>` | `.md` files in `slashcommands/` (excluding `docs.md`) |

`SkillEntry` carries `{ id, sourceDir }` where `id` is the directory name and `sourceDir` is the absolute path. `MdFileEntry` carries `{ filename, content }` where content is the raw file text read at load time.

`loadSkillsetPackage({ profileDir })` reads the profile directory and returns a `SkillsetPackage`. Missing directories or files produce empty arrays / null rather than errors. The internal `readMdFiles()` helper handles the subagent and slashcommand directories with the same logic: read all `.md` files except `docs.md`.

All types and the loader function are re-exported through `nori.ts` for convenient access.

### Things to Know

- The `NoriJson` type serves dual purpose: it describes both skillset manifests (which have `skills`, `subagents`, `slashcommands`) and individual skill manifests (which have `scripts`). Both share the same type with optional fields. The `type` field (`NoriJsonType`) distinguishes between these: `"skillset"` for skillset manifests, `"skill"` for standalone skill packages, and `"inlined-skill"` for skills bundled within a skillset tarball.
- The `repository` field is a plain string URL, not a `{ type, url }` object. This matches the registrar's canonical format.
- All optional fields accept `null` in addition to `undefined`, following the codebase convention.
- `SkillsetPackage` is a load-time snapshot: it reads the profile directory once and all loaders operate on this snapshot. Template substitution (which depends on the install directory) remains an install-time concern handled by each sub-loader -- `SkillsetPackage` carries raw content before substitution.
- Skills in `SkillsetPackage` are represented as `{ id, sourceDir }` rather than pre-read content because the skills loader needs to copy entire directory trees (with recursive template substitution), not just single files.
- `docs.md` files are explicitly excluded from the `MdFileEntry` collections to prevent documentation files from being installed as subagents or slash commands.

Created and maintained by Nori.
