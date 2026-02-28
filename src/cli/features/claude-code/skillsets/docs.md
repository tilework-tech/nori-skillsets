# Noridoc: skillsets

Path: @/src/cli/features/claude-code/skillsets

### Overview

This directory previously contained the skillset loader pipeline for Claude Code (profilesLoader, skillsetLoaderRegistry, and sub-loaders for skills, claudemd, slashcommands, subagents). Those loaders have been consolidated into shared implementations at @/src/cli/features/shared/ and @/src/cli/features/agentOperations.ts. What remains in this directory is the manifest test file and the skill resolver test file.

### How it fits into the larger codebase

The skillset installation pipeline is now defined in the `claudeCodeAgentConfig.getLoaders()` method in @/src/cli/features/claude-code/agent.ts, which references shared loaders from @/src/cli/features/shared/ (skillsLoader, createInstructionsLoader, createSlashCommandsLoader, createSubagentsLoader). The permissions setup that was previously in `loader.ts` is now handled by @/src/cli/features/claude-code/permissionsLoader.ts. All lifecycle operations (installSkillset, switchSkillset, detectLocalChanges, etc.) are shared functions in @/src/cli/features/agentOperations.ts.

The manifest module (@/src/cli/features/manifest.ts) tracks installed files for local change detection. It uses a **whitelist approach**: only Nori-managed paths are tracked, ignoring the agent's own runtime directories. Managed files and directories are derived from loader declarations via `getManagedFiles()` and `getManagedDirs()` in @/src/cli/features/agentOperations.ts.

### Core Implementation

**Installation Manifest** (@/src/cli/features/manifest.ts): Per-agent manifests are stored at `~/.nori/manifests/<agentName>.json`. A legacy fallback path (`~/.nori/installed-manifest.json`) is checked when the per-agent manifest does not exist. The manifest uses SHA-256 hashes and filters with `EXCLUDED_FILES` (`.nori-version`, `nori.json`). The `removeManagedFiles()` function handles cleanup: removes manifest-tracked files, the `.nori-managed` marker, excluded files from managed directories, and empty directories.

**Skills as First-Class Citizens**: Skills can be inline (in skillset's `skills/` folder) or external (declared in `skills.json` or `nori.json` `dependencies.skills`, downloaded to skillset's `skills/` folder). The resolver module at @/src/cli/features/skillResolver.ts provides read/write operations for `skills.json`.

### Things to Know

**~/.nori/profiles/ is the single source of truth**: All feature loaders read from `~/.nori/profiles/`. No built-in skillsets are shipped. Profiles are never deleted during install operations.

**Self-contained skillsets**: Each skillset contains all content it needs directly. There is no mixin composition, inheritance, or conditional injection.

**Missing skillset content is valid**: All shared loaders handle missing source content gracefully. The instructions loader clears the managed block when no config file exists. The skills, slashcommands, and subagents loaders continue silently when source directories are missing.

**nori.json as validation marker**: A directory is only a valid skillset if it contains `nori.json`. The `ensureNoriJson()` shim in @/src/cli/features/skillsetMetadata.ts auto-creates the manifest for legacy directories.

**Template placeholders in skillset files**: Source markdown files use `{{skills_dir}}` and similar placeholders. Template substitution is applied by shared loaders during installation via @/src/cli/features/template.ts. The `installDir` passed to substitution is the agent config directory (e.g., `~/.claude`), not the parent.

**Managed block marker idempotency**: The shared instructions loader strips existing managed block markers from source content before wrapping with fresh markers, preventing double-nesting from captured skillsets.

**Manifest whitelist for change detection**: The per-agent manifest only tracks Nori-managed paths, excluding agent runtime directories. The `compareManifest()` function filters out stale entries from older manifests that tracked non-whitelisted paths.

## Architecture

**Profile Source of Truth: `~/.nori/profiles/`**

```
~/.nori/
  profiles/
    my-skillset/         # Self-contained skillset
      skills/           # Inline skills + downloaded external skills
      subagents/
      slashcommands/
      CLAUDE.md
      nori.json         # Unified manifest
    myorg/
      org-skillset/      # Namespaced skillset
  manifests/
    claude-code.json     # Per-agent SHA-256 hashes for change detection
    cursor-agent.json
```

### Install Flow

1. **Config loader** persists `.nori-config.json`
2. **Permissions loader** (Claude-specific) configures `settings.json` with profiles and skills directory access
3. **Shared loaders run** (skills, instructions, slashcommands, subagents) -- reading from `~/.nori/profiles/<activeSkillset>/`, writing to the agent's config directory
4. **Agent-specific loaders** (hooks, statusline, announcements for Claude Code)
5. **Manifest written** by `installSkillset()` in @/src/cli/features/agentOperations.ts

Created and maintained by Nori.
