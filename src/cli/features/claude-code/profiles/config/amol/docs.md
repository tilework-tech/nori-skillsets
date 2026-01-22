# Noridoc: amol

Path: @/src/cli/features/claude-code/profiles/config/amol

### Overview

Self-contained profile for full autonomy workflow with frequent commits. Contains all skills, subagents, and slash commands directly inlined - no composition or inheritance from other sources. This profile is designed for experienced developers who want minimal interruptions and high autonomy.

### How it fits into the larger codebase

This is one of the built-in profiles shipped with Nori at @/src/cli/features/claude-code/profiles/config/. During installation, the profiles loader (@/src/cli/features/claude-code/profiles/loader.ts) copies this entire directory to `~/.nori/profiles/amol/`. Feature sub-loaders then read from this location:
- Skills are copied to `~/.claude/skills/` by @/src/cli/features/claude-code/profiles/skills/loader.ts
- Subagents are copied to `~/.claude/agents/` by @/src/cli/features/claude-code/profiles/subagents/loader.ts
- Slash commands are copied to `~/.claude/commands/` by @/src/cli/features/claude-code/profiles/slashcommands/loader.ts
- CLAUDE.md is processed and written by @/src/cli/features/claude-code/profiles/claudemd/loader.ts

### Core Implementation

**Profile Content**: This profile directory contains:
- `CLAUDE.md` - Full workflow instructions emphasizing autonomy
- `nori.json` - Unified manifest with name, version, and description
- `skills/` - All skills inlined (TDD, debugging, git-worktrees, brainstorming, etc.)
- `subagents/` - All subagents inlined (documentation, codebase analysis, web research)
- `slashcommands/` - Profile-specific slash commands

**Paid content**: Skills and subagents with `paid-` prefix (e.g., `paid-recall/`, `paid-memorize/`) are tier-gated. For paid users, the prefix is stripped when installing. For free users, these items are skipped entirely.

### Things to Know

**Self-contained architecture**: All profile content is inlined directly in this directory. There is no mixin composition or inheritance - this profile is complete as-is. This simplifies the architecture at the cost of some content duplication across profiles.

**Template placeholders**: The CLAUDE.md and skill files use placeholders like `{{skills_dir}}` that are substituted with actual paths during installation.

**Profile preservation**: Once copied to `~/.nori/profiles/amol/`, this profile is never overwritten during subsequent installs. Users can customize it and their changes will persist. To get newer versions, users must use the registry.

Created and maintained by Nori.
