# Noridoc: product-manager

Path: @/src/cli/features/claude-code/profiles/config/product-manager

### Overview

Self-contained profile for non-technical users and product managers. Contains all skills, subagents, and slash commands directly inlined. This profile provides high technical autonomy with product-focused questions, and automatically creates PRs for code changes.

### How it fits into the larger codebase

This is one of the built-in profiles shipped with Nori at @/src/cli/features/claude-code/profiles/config/. During installation, the profiles loader (@/src/cli/features/claude-code/profiles/loader.ts) copies this entire directory to `~/.nori/profiles/product-manager/`. Feature sub-loaders then read from this location:
- Skills are copied to `~/.claude/skills/` by @/src/cli/features/claude-code/profiles/skills/loader.ts
- Subagents are copied to `~/.claude/agents/` by @/src/cli/features/claude-code/profiles/subagents/loader.ts
- Slash commands are copied to `~/.claude/commands/` by @/src/cli/features/claude-code/profiles/slashcommands/loader.ts
- CLAUDE.md is processed and written by @/src/cli/features/claude-code/profiles/claudemd/loader.ts

### Core Implementation

**Profile Content**: This profile directory contains:
- `CLAUDE.md` - Instructions focused on product management workflow
- `nori.json` - Unified manifest with name, version, and description
- `skills/` - All skills inlined (TDD, debugging, git-worktrees, brainstorming, etc.)
- `subagents/` - All subagents inlined (documentation, codebase analysis, web research)
- `slashcommands/` - Profile-specific slash commands

**Paid content**: Skills and subagents with `paid-` prefix are tier-gated.

### Things to Know

**Self-contained architecture**: All profile content is inlined directly in this directory. There is no mixin composition or inheritance.

**Template placeholders**: The CLAUDE.md and skill files use placeholders like `{{skills_dir}}` that are substituted with actual paths during installation.

**Profile preservation**: Once copied to `~/.nori/profiles/product-manager/`, this profile is never overwritten during subsequent installs.

Created and maintained by Nori.
