# Noridoc: documenter

Path: @/src/cli/features/claude-code/profiles/config/documenter

### Overview

Self-contained profile focused on documentation workflows. Contains all skills, subagents, and slash commands directly inlined. This profile is designed for users who primarily want assistance with creating and maintaining documentation in their codebase.

### How it fits into the larger codebase

This is one of the built-in profiles shipped with Nori at @/src/cli/features/claude-code/profiles/config/. During installation, the profiles loader (@/src/cli/features/claude-code/profiles/loader.ts) copies this entire directory to `~/.nori/profiles/documenter/`. Feature sub-loaders then read from this location:
- Skills are copied to `~/.claude/skills/` by @/src/cli/features/claude-code/profiles/skills/loader.ts
- Subagents are copied to `~/.claude/agents/` by @/src/cli/features/claude-code/profiles/subagents/loader.ts
- Slash commands are copied to `~/.claude/commands/` by @/src/cli/features/claude-code/profiles/slashcommands/loader.ts
- CLAUDE.md is processed and written by @/src/cli/features/claude-code/profiles/claudemd/loader.ts

### Core Implementation

**Profile Content**: This profile directory contains:
- `CLAUDE.md` - Instructions focused on documentation collaboration
- `nori.json` - Unified manifest with name, version, and description
- `skills/` - Documentation-related skills (updating-noridocs, etc.)
- `subagents/` - Documentation subagents (nori-initial-documenter, nori-change-documenter)
- `slashcommands/` - Documentation commands (nori-init-docs, nori-sync-docs)

**Documentation subagents**: The subagents use a **two-pass documentation approach**:
1. Top-down pass creates architectural documentation starting from high-level understanding
2. Bottom-up pass verifies accuracy by starting from leaf directories and working upward

**Paid content**: Skills and subagents with `paid-` prefix are tier-gated and handled appropriately during installation.

### Things to Know

**Self-contained architecture**: All profile content is inlined directly in this directory. There is no mixin composition or inheritance.

**Documentation philosophy**: The profile emphasizes documenting the "why" over the "what", keeping documentation concise, and focusing on architectural decisions and how components fit together.

**Noridoc format**: Documentation follows a consistent format with sections for Overview, How it fits into the larger codebase, Core Implementation, and Things to Know.

Created and maintained by Nori.
