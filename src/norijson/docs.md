# Noridoc: norijson

Path: @/src/norijson

### Overview

Type definitions for the `nori.json` manifest format -- the package descriptor used by both skillsets and individual skills in the Nori ecosystem. This module is types-only with no runtime logic.

### How it fits into the larger codebase

The `NoriJson` type defined here is used by CLI commands that read, validate, and construct manifests during skillset packaging (`@/src/cli/commands/registry-upload/`), downloading, and installation. The skillset content types (`SkillsetSkill`, `SkillsetSubagent`, `SkillsetSlashCommand`) describe what a skillset directory contains after discovery.

### Core Implementation

**`nori.ts`** defines `NoriJson`, the unified manifest type. Key fields: `name`, `version` (required), `type` (one of `"skillset"`, `"skill"`, `"inlined-skill"`), and optional content arrays (`skills`, `subagents`, `slashcommands` for skillsets; `scripts` for skills). The `dependencies` field maps skill names to version ranges. The type allows arbitrary additional fields via an index signature.

**`skillset.ts`** defines the content types that represent discovered skillset components: `SkillsetSkill` (with `id` from directory name and `name`/`description` from SKILL.md frontmatter), `SkillsetSubagent`, and `SkillsetSlashCommand`. These are inlined as arrays in `NoriJson`.

### Things to Know

The `type` field distinguishes between full skillsets, standalone skills, and skills that were inlined (extracted) from a skillset upload. The `"inlined-skill"` type is set server-side during upload when skills are extracted from a skillset package.

Created and maintained by Nori.
