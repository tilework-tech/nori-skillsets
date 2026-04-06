# Noridoc: norijson

Path: @/src/norijson

### Overview

- Type definitions and runtime operations for the `nori.json` manifest format -- the package descriptor used by both skillsets and individual skills in the Nori ecosystem.
- The `Skillset` type, parser, and discovery logic for resolving skillset directories from `~/.nori/profiles/`.

### How it fits into the larger codebase

- `NoriJson` is consumed by CLI commands for skillset packaging (@/src/cli/commands/registry-upload/), downloading, and installation.
- The metadata CRUD functions (`readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `addSubagentToNoriJson`, `ensureNoriJson`) in `nori.ts` are called by CLI commands (fork, new, register, external, skill-download) and by `parseSkillset()` in `skillset.ts`.
- `parseSkillset()` in `skillset.ts` is called by `agentOperations.installSkillset()` in @/src/cli/features/agentOperations.ts to resolve the active skillset before running loaders.
- `listSkillsets()` in `skillset.ts` is called directly by CLI commands (switch-skillset, list-skillsets) to discover installed skillsets.
- `getNoriDir()` and `getNoriSkillsetsDir()` in `skillset.ts` provide the canonical paths (`~/.nori/` and `~/.nori/profiles/`) used throughout the CLI for skillset directory resolution.

```
CLI Commands (fork, new, register, switch, list, external, skill-download)
    |
    +-- nori.ts: readSkillsetMetadata / writeSkillsetMetadata / addSkillToNoriJson / addSubagentToNoriJson / ensureNoriJson
    |
    +-- skillset.ts: parseSkillset / listSkillsets / getNoriDir / getNoriSkillsetsDir
            |
            +-- calls ensureNoriJson / readSkillsetMetadata from nori.ts
```

### Core Implementation

**`nori.ts`** defines `NoriJson`, the unified manifest type. Key fields: `name`, `version` (required), `type` (one of `"skillset"`, `"skill"`, `"inlined-skill"`, `"subagent"`, `"inlined-subagent"`), and optional content arrays (`skills`, `subagents`, `slashcommands` for skillsets; `scripts` for skills). The `dependencies` field maps skill names and subagent names to version ranges. The type allows arbitrary additional fields via an index signature.

`nori.ts` also defines the skillset content types (`SkillsetSkill`, `SkillsetSubagent`, `SkillsetSlashCommand`) that describe discovered skillset components. `SkillsetSubagent` includes an optional `scripts` field for directory-based subagents that bundle scripts alongside their `SUBAGENT.md`. Runtime functions for `nori.json` file I/O:

| Function | Purpose |
|----------|---------|
| `readSkillsetMetadata` | Reads and parses `nori.json` from a skillset directory |
| `writeSkillsetMetadata` | Writes `NoriJson` to `nori.json` in a skillset directory |
| `addSkillToNoriJson` | Adds/updates a skill dependency in `nori.json`, creating the file if missing |
| `addSubagentToNoriJson` | Adds/updates a subagent dependency in `nori.json`, creating the file if missing (mirrors `addSkillToNoriJson`) |
| `ensureNoriJson` | Backwards-compat shim: creates `nori.json` for legacy skillset dirs that have a config file or both `skills/` and `subagents/` subdirectories but no manifest |

**`skillset.ts`** provides path utilities, the `Skillset` type, and discovery:

- `getNoriDir()` / `getNoriSkillsetsDir()`: Canonical path getters for `~/.nori/` and `~/.nori/profiles/`.
- `MANIFEST_FILE`: The constant `"nori.json"`, used to identify valid skillsets.
- `Skillset` type: Represents a parsed skillset directory with `name`, `dir`, `metadata` (the parsed `NoriJson`), and nullable paths for `skillsDir`, `configFilePath`, `slashcommandsDir`, `subagentsDir`.
- `parseSkillset({ skillsetName?, skillsetDir? })`: Resolves a skillset directory, calls `ensureNoriJson()`, reads metadata, probes for optional subdirectories/files. Checks for `AGENTS.md` first, then falls back to `CLAUDE.md` for backward compatibility.
- `listSkillsets()`: Scans `~/.nori/profiles/` for directories containing `nori.json`, supporting flat and namespaced (org/name) layouts. Calls `ensureNoriJson()` for backwards compatibility.

### Things to Know

- The `type` field distinguishes between full skillsets, standalone skills/subagents, and skills/subagents that were inlined from a skillset upload. `"inlined-skill"` and `"inlined-subagent"` types are set during the upload flow when the user chooses to keep a skill or subagent bundled in the skillset tarball rather than extracting it as an independent package. The `"subagent"` and `"inlined-subagent"` types mirror the skill types, giving subagents the same lifecycle as skills for upload, versioning, and registry distribution.
- `NoriJsonDependencies.subagents` maps subagent names to version ranges, mirroring the `skills` dependency map.
- `ensureNoriJson` uses a `looksLikeSkillset` heuristic: it checks for the presence of a known config file name (defaults to `["AGENTS.md", "CLAUDE.md"]`) or both `skills/` and `subagents/` subdirectories. This allows it to auto-generate manifests for user-created skillsets that predate the `nori.json` convention.
- `parseSkillset` checks for config files in priority order: `AGENTS.md` first, then `CLAUDE.md`. When both exist, `AGENTS.md` wins. New skillsets are created with `AGENTS.md`; `CLAUDE.md` is supported for backward compatibility with existing skillsets.

Created and maintained by Nori.
