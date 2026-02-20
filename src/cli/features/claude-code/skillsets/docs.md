# Noridoc: skillsets

Path: @/src/cli/features/claude-code/skillsets

### Overview

The skillsets module manages the installation, composition, and metadata of skillsets (formerly called profiles). It handles creating the `~/.nori/profiles/` directory, configuring permissions, installing profile-dependent features (skills, CLAUDE.md, slash commands, subagents), and maintaining `nori.json` manifest files.

### How it fits into the larger codebase

`profilesLoader` (in `loader.ts`) is registered in `@/src/cli/features/claude-code/loaderRegistry.ts` and runs second in the install pipeline (after config). After setting up the profiles directory and permissions, it delegates to the `ProfileLoaderRegistry` which runs sub-loaders for skills, CLAUDE.md, slash commands, and subagents. These sub-loaders live in subdirectories (`claudemd/`, `skills/`, `slashcommands/`, `subagents/`). The `metadata.ts` module is called from `@/src/cli/features/managedFolder.ts` and `@/src/cli/features/claude-code/agent.ts` for manifest validation.

### Core Implementation

`loader.ts` creates `~/.nori/profiles/` and adds it to `permissions.additionalDirectories` in `{installDir}/.claude/settings.json` so Claude Code can read skillset files. It then runs all `ProfileLoader` instances from the `ProfileLoaderRegistry`.

`skillsetLoaderRegistry.ts` is a singleton registry ordering the profile sub-loaders: skills -> claudemd -> slashcommands -> subagents. Skills must install before claudemd because CLAUDE.md generation reads from the installed skills directory.

`metadata.ts` provides CRUD operations for `nori.json` manifests: `readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, and `ensureNoriJson`. The `ensureNoriJson` function is a backwards-compatibility shim that auto-generates a `nori.json` for directories that look like skillsets (have `CLAUDE.md` or both `skills/` and `subagents/` subdirectories) but lack a manifest.

`manifest.ts` implements file-level change tracking using SHA-256 hashes. It computes manifests of installed files, stores them at `~/.nori/installed-manifest.json`, and compares against current disk state to detect modifications, additions, and deletions. It whitelists specific managed files (`CLAUDE.md`, `settings.json`, `nori-statusline.sh`) and directories (`skills`, `commands`, `agents`) while excluding metadata files (`.nori-version`, `nori.json`).

### Things to Know

The `ProfileLoaderRegistry` enforces that skills install before CLAUDE.md. The manifest system in `manifest.ts` only tracks files within a defined whitelist (`MANAGED_FILES` and `MANAGED_DIRS`), so user-created files outside these paths are not affected by factory reset or manifest comparison. `ensureNoriJson` silently skips directories that do not look like skillsets, avoiding false positives on org-level namespace directories.

Created and maintained by Nori.
