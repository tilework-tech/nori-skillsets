# Noridoc: skillsets

Path: @/src/cli/features/claude-code/skillsets

### Overview

This directory now serves primarily as a historical home for shared test files related to skillset infrastructure. The skillset installation loaders that previously lived here (`loader.ts`, `skillsetLoaderRegistry.ts`, and subdirectories `claudemd/`, `skills/`, `slashcommands/`, `subagents/`) have been extracted to shared profile loaders at @/src/cli/features/shared/profileLoaders/. Skillset metadata operations have been extracted to @/src/cli/features/skillsetMetadata.ts. The manifest module has been extracted to @/src/cli/features/manifest.ts.

### How it fits into the larger codebase

- The remaining test files validate shared infrastructure that was extracted from this directory: `manifest.test.ts` tests @/src/cli/features/manifest.ts, and `skills/resolver.test.ts` tests @/src/cli/features/skillResolver.ts.
- All profile installation logic now lives in @/src/cli/features/shared/profileLoaders/, which is called by the shared `installSkillset` handler in @/src/cli/features/shared/agentHandlers.ts. The shared handler replaces the old per-agent `installSkillset` methods.
- Skillset metadata CRUD operations (`readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `ensureNoriJson`) live in @/src/cli/features/skillsetMetadata.ts.
- The `Skillset` type and `parseSkillset()` parser live in @/src/cli/features/skillset.ts.

### Core Implementation

**Remaining files:**
- `manifest.test.ts` -- tests the shared manifest module at @/src/cli/features/manifest.ts (file-level SHA-256 change tracking, whitelist filtering, per-agent manifest storage)
- `skills/resolver.test.ts` -- tests the shared skill resolver at @/src/cli/features/skillResolver.ts (skills.json parsing, version resolution)

**Shared profile loaders** (at @/src/cli/features/shared/profileLoaders/):
- `profilesLoader.ts` -- orchestrates profile installation: creates `~/.nori/profiles/`, configures agent-specific permissions, parses the active skillset via `parseSkillset()`, and runs sub-loaders in order
- `skillsLoader.ts` -- copies skills from skillset to agent's skills directory with template substitution, then copies bundled skills
- `instructionsMdLoader.ts` -- generates the agent's instruction file (CLAUDE.md or AGENTS.md) with managed block markers
- `slashCommandsLoader.ts` -- copies slash command .md files to the agent's commands directory
- `subagentsLoader.ts` -- copies subagent .md files to the agent's agents directory

The shared `profilesLoader.ts` enforces installation order: skills -> instructionsMd -> slashCommands -> subagents. Skills must install before instructionsMd because instruction file generation reads from the installed skills directory.

**Installation Manifest** (@/src/cli/features/manifest.ts): Tracks installed files using SHA-256 hashes with a whitelist approach -- only Nori-managed paths are tracked. Per-agent manifests are stored at `~/.nori/manifests/<agentName>.json` with legacy fallback at `~/.nori/installed-manifest.json`.

**Skill Resolution** (@/src/cli/features/skillResolver.ts): Provides read/write operations for `skills.json` (legacy dependency format) alongside the unified `nori.json` `dependencies.skills` format.

### Things to Know

**~/.nori/profiles/ is the single source of truth**: All feature loaders read from `~/.nori/profiles/` instead of the npx package location. No built-in skillsets are shipped. Users must download or create skillsets.

**Self-contained skillsets**: Each skillset contains all content it needs directly. No mixin composition, inheritance, or conditional injection.

**Missing skillset content is valid**: All four shared profile loaders handle missing source content gracefully rather than throwing ENOENT. The instruction file loader handles missing `CLAUDE.md` by preserving existing managed block markers with empty content. This ensures switching to an empty/minimal skillset does not crash the install pipeline.

**Template placeholders**: Source markdown files use placeholders like `{{skills_dir}}`. Template substitution is applied by shared profile loaders during installation via @/src/cli/features/template.ts. The `substituteTemplatePaths()` function expects its `installDir` parameter to be the agent config directory (e.g., `~/.claude`), not the parent. Shared loaders compute this via `getAgentDir({ agentConfig, installDir })` from @/src/cli/features/shared/agentHandlers.ts.

**Managed block marker idempotency**: The shared instruction file loader strips existing managed block markers from profile content before wrapping with fresh markers, preventing double-nesting when skillset content was created by config capture.

**nori.json as validation marker**: A directory is only a valid skillset if it contains `nori.json`. The `ensureNoriJson()` shim in @/src/cli/features/skillsetMetadata.ts auto-creates manifests for legacy skillset directories that lack one.

**Skills as first-class citizens**: Skills can be inline (in skillset's `skills/` folder) or external (declared in `skills.json` with semver version ranges, downloaded to skillset's `skills/` directory). External skills take precedence over inline skills with the same name.

## Architecture

**Profile Source of Truth: `~/.nori/profiles/`**

```
~/.nori/
  profiles/
    my-skillset/         # Self-contained skillset (downloaded or user-created)
      skills/           # Inline skills + downloaded external skills
      skills.json       # External skill dependencies metadata (optional)
      subagents/
      slashcommands/
      CLAUDE.md
      nori.json         # Unified manifest (name, version, description, dependencies)
    myorg/
      org-skillset/      # Namespaced skillset from organization registry
  manifests/
    claude-code.json     # Per-agent SHA-256 hashes for change detection
  installed-manifest.json  # Legacy manifest path (read as fallback)

~/.claude/
  skills/             # Final installed skills (Nori-managed)
  agents/             # Copied from active skillset (Nori-managed)
  commands/           # Copied from active skillset (Nori-managed)
  CLAUDE.md           # Generated from active skillset (Nori-managed)
  settings.json       # Claude settings with Nori permissions (Nori-managed)
  nori-statusline.sh  # Statusline script (Nori-managed)
```

Created and maintained by Nori.
