# Noridoc: Profiles

Path: @/src/cli/features/cursor-agent/profiles

### Overview

Profile system that provides complete, self-contained Nori configurations for Cursor IDE. Each profile directory contains all required content directly (AGENTS.md, rules/, subagents/) without any composition or inheritance. Profiles are obtained from the registry or created by users -- the package does not ship any built-in profiles. The `~/.cursor/profiles/` directory serves as the single source of truth for installed profiles.

### How it fits into the larger codebase

The profiles loader is the top-level loader registered with CursorLoaderRegistry (@/src/cli/features/cursor-agent/loaderRegistry.ts). During installation, it:

1. Creates the `~/.cursor/profiles/` directory if it does not exist
2. Invokes sub-loaders via CursorProfileLoaderRegistry for rules, subagents, and AGENTS.md installation

The architecture mirrors claude-code's profile system (@/src/cli/features/claude-code/profiles/), using the same self-contained profile pattern. Like claude-code, no built-in profiles are shipped with the package.

```
profilesLoader (loader.ts)
    |
    +-- Create ~/.cursor/profiles/ directory
    |
    +-- CursorProfileLoaderRegistry (profileLoaderRegistry.ts)
            |
            +-- rulesLoader (@/src/cli/features/cursor-agent/profiles/rules/loader.ts)
            +-- subagentsLoader (@/src/cli/features/cursor-agent/profiles/subagents/loader.ts)
            +-- agentsMdLoader (@/src/cli/features/cursor-agent/profiles/agentsmd/loader.ts)
                    |
                    +-- Applies template substitution
                    +-- Generates "# Nori Rules System" section
                    +-- Writes final AGENTS.md to project root
```

### Core Implementation

**Profile Structure**: Each profile directory is self-contained with:
- `AGENTS.md` (instructions file, required for profile to be valid)
- `nori.json` (unified manifest with name, version, description, and optional dependencies)
- `rules/` (rule directories, each containing RULE.md)
- `subagents/` (subagent .md files)

**Profile Metadata (nori.json)**: The `ProfileMetadata` type (@/src/cli/features/cursor-agent/profiles/metadata.ts) defines the unified manifest format:
```json
{
  "name": "profile-name",
  "version": "1.0.0",
  "description": "Human-readable description",
  "dependencies": {
    "skills": { "skill-name": "*" }
  }
}
```

The `readProfileMetadata()` function reads `nori.json` first, falling back to legacy `profile.json` for backward compatibility with older profiles.

**Installation Flow**: The `installProfiles()` function:
1. Creates `~/.cursor/profiles/` directory if it does not exist
2. Invokes sub-loaders for rules, subagents, and AGENTS.md

The `profiles/config/` directory in the package is empty -- no built-in profiles are shipped.

**Uninstall Behavior**: Profiles are never deleted during uninstall. Users manage their profiles via the registry and all customizations are preserved.

### Things to Know

**No built-in profiles**: The package does not bundle any default profiles. The `profiles/config/` directory is empty. Users must download profiles from the registry or create their own.

**Self-contained profiles**: Each profile contains all content it needs directly. There is no mixin composition, inheritance, or conditional injection.

**AGENTS.md as validation marker**: A directory is only treated as a valid profile if it contains AGENTS.md. Directories without AGENTS.md are skipped.

**Template substitution in profile loaders**: All profile sub-loaders apply template substitution to `.md` files during the final copy stage. This replaces placeholders like `{{rules_dir}}`, `{{subagents_dir}}` with actual paths. Substitution is applied by:
- **rulesLoader** - Uses `copyDirWithTemplateSubstitution()` when copying to `~/.cursor/rules/`
- **subagentsLoader** - Uses `copyDirWithTemplateSubstitution()` when copying to `~/.cursor/subagents/`
- **agentsMdLoader** - Uses `substituteTemplatePaths()` on AGENTS.md content

**User content preservation**: The rulesLoader preserves user-created rules (rules not defined in the profile config). During install, only Nori-managed rule directories are removed before copying fresh versions.

**Dynamic rules list generation**: The agentsMdLoader scans `~/.cursor/rules/` for `RULE.md` files, extracts the `description` field from each file's YAML frontmatter, and generates a formatted "# Nori Rules System" section listing all available rules.

**Rule file format**: Each RULE.md file uses Cursor's YAML frontmatter format:
```yaml
---
description: Use when [trigger condition] - [what it does]
alwaysApply: false
---
```

**Subagents system**: Subagents provide Task tool-like functionality for Cursor, which lacks a built-in Task tool. The subagentsLoader copies `.md` files from the profile's `subagents/` directory to `~/.cursor/subagents/`. Each subagent is invoked via the `cursor-agent` CLI in headless mode.

**Parallel to claude-code**: Key differences:

| Aspect | cursor-agent | claude-code |
|--------|--------------|-------------|
| Instructions file | AGENTS.md | CLAUDE.md |
| Feature directories | `rules/`, `subagents/` | `skills/`, `subagents/`, `slashcommands/` |
| Target directory | `~/.cursor/` | `~/.claude/` |
| Profile storage | `~/.cursor/profiles/` | `~/.nori/profiles/` |

Created and maintained by Nori.
