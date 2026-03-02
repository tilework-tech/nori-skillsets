# Noridoc: norijson

Path: @/src/norijson

### Overview

- Type definitions and runtime operations for the `nori.json` manifest format -- the package descriptor used by both skillsets and individual skills in the Nori ecosystem.
- The `Skillset` type, parser, and discovery logic for resolving skillset directories from `~/.nori/profiles/`.

### How it fits into the larger codebase

- `NoriJson` is consumed by CLI commands for skillset packaging (@/src/cli/commands/registry-upload/), downloading, and installation.
- The metadata CRUD functions (`readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `ensureNoriJson`) in `nori.ts` are called by CLI commands (fork, new, register, external, skill-download) and by `parseSkillset()` in `skillset.ts`.
- `parseSkillset()` in `skillset.ts` is called by `agentOperations.installSkillset()` in @/src/cli/features/agentOperations.ts to resolve the active skillset before running loaders.
- `listSkillsets()` in `skillset.ts` is called directly by CLI commands (switch-skillset, list-skillsets) to discover installed skillsets.
- `getNoriDir()` and `getNoriSkillsetsDir()` in `skillset.ts` provide the canonical paths (`~/.nori/` and `~/.nori/profiles/`) used throughout the CLI for skillset directory resolution.

```
CLI Commands (fork, new, register, switch, list, external, skill-download)
    |
    +-- nori.ts: readSkillsetMetadata / writeSkillsetMetadata / addSkillToNoriJson / ensureNoriJson
    |
    +-- skillset.ts: parseSkillset / listSkillsets / getNoriDir / getNoriSkillsetsDir
            |
            +-- calls ensureNoriJson / readSkillsetMetadata from nori.ts
```

### Core Implementation

**`nori.ts`** defines `NoriJson`, the unified manifest type. Key fields: `name`, `version` (required), `type` (one of `"skillset"`, `"skill"`, `"inlined-skill"`), and optional content arrays (`skills`, `subagents`, `slashcommands` for skillsets; `scripts` for skills). The `dependencies` field maps skill names to version ranges. The type allows arbitrary additional fields via an index signature.

`nori.ts` also defines the skillset content types (`SkillsetSkill`, `SkillsetSubagent`, `SkillsetSlashCommand`) that describe discovered skillset components, and provides runtime functions for `nori.json` file I/O:

| Function | Purpose |
|----------|---------|
| `readSkillsetMetadata` | Reads and parses `nori.json` from a skillset directory |
| `writeSkillsetMetadata` | Writes `NoriJson` to `nori.json` in a skillset directory |
| `addSkillToNoriJson` | Adds/updates a skill dependency in `nori.json`, creating the file if missing |
| `ensureNoriJson` | Backwards-compat shim: creates `nori.json` for legacy skillset dirs that have a config file or both `skills/` and `subagents/` subdirectories but no manifest |

**`skillset.ts`** provides path utilities, the `Skillset` type, and discovery:

- `getNoriDir()` / `getNoriSkillsetsDir()`: Canonical path getters for `~/.nori/` and `~/.nori/profiles/`.
- `MANIFEST_FILE`: The constant `"nori.json"`, used to identify valid skillsets.
- `Skillset` type: Represents a parsed skillset directory with `name`, `dir`, `metadata` (the parsed `NoriJson`), and nullable paths for `skillsDir`, `configFilePath`, `slashcommandsDir`, `subagentsDir`.
- `parseSkillset({ skillsetName?, skillsetDir? })`: Resolves a skillset directory, calls `ensureNoriJson()`, reads metadata, probes for optional subdirectories/files. The `configFileName` is hardcoded to `"CLAUDE.md"` internally.
- `listSkillsets()`: Scans `~/.nori/profiles/` for directories containing `nori.json`, supporting flat and namespaced (org/name) layouts. Calls `ensureNoriJson()` for backwards compatibility.

### Things to Know

- The `type` field distinguishes between full skillsets, standalone skills, and skills that were inlined (extracted) from a skillset upload. The `"inlined-skill"` type is set server-side during upload when skills are extracted from a skillset package.
- `ensureNoriJson` uses a `looksLikeSkillset` heuristic: it checks for the presence of a known config file name (default `"CLAUDE.md"`) or both `skills/` and `subagents/` subdirectories. This allows it to auto-generate manifests for user-created skillsets that predate the `nori.json` convention.
- `parseSkillset` hardcodes `"CLAUDE.md"` as the config file name because all skillsets use `CLAUDE.md` as the source file. The mapping to each agent's native format happens at write time in the instructions loader.

Created and maintained by Nori.
