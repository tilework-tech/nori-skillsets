# Noridoc: norijson

Path: @/src/norijson

### Overview

- Shared TypeScript type definitions used across the codebase
- Contains the canonical `NoriJson` manifest type that matches the nori-registrar repo's definition

### How it fits into the larger codebase

- `NoriJson` (@/src/norijson/nori.ts) is the single source of truth for the nori.json manifest shape, imported directly by CLI commands that create or read nori.json files (e.g., `new-skillset`, `register-skillset`, `registry-download`)
- `SkillsetSkill`, `SkillsetSubagent`, `SkillsetSlashCommand` (@/src/norijson/skillset.ts) define the inlined content types that appear as fields within `NoriJson`. These represent content discovered from a skillset directory (skill directories, subagent .md files, slash command .md files)
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

### Things to Know

- The `NoriJson` type serves dual purpose: it describes both skillset manifests (which have `skills`, `subagents`, `slashcommands`) and individual skill manifests (which have `scripts`). Both share the same type with optional fields. The `type` field (`NoriJsonType`) distinguishes between these: `"skillset"` for skillset manifests, `"skill"` for standalone skill packages, and `"inlined-skill"` for skills bundled within a skillset tarball.
- The `repository` field is a plain string URL, not a `{ type, url }` object. This matches the registrar's canonical format.
- All optional fields accept `null` in addition to `undefined`, following the codebase convention.

Created and maintained by Nori.
