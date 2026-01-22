# Noridoc: Profiles

Path: @/src/cli/features/cursor-agent/profiles

### Overview

Profile system that provides complete, self-contained Nori configurations for Cursor IDE. Each profile directory contains all required content directly (AGENTS.md, rules/, subagents/) without any composition or inheritance. Profiles are copied to `~/.cursor/profiles/` during installation.

### How it fits into the larger codebase

The profiles loader is the top-level loader registered with CursorLoaderRegistry (@/src/cli/features/cursor-agent/loaderRegistry.ts). During installation, it:

1. Reads profile directories from `config/` (skipping directories starting with `_`)
2. Copies each profile directly to `~/.cursor/profiles/` (skips legacy profile.json during copy)
3. Invokes sub-loaders via CursorProfileLoaderRegistry for rules, subagents, and AGENTS.md installation

The architecture mirrors claude-code's profile system (@/src/cli/features/claude-code/profiles/), using the same self-contained profile pattern.

```
profilesLoader (loader.ts)
    |
    +-- Read AGENTS.md (validation marker)
    +-- Copy profile directly to ~/.cursor/profiles/
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

Profiles are copied directly to `~/.cursor/profiles/` without any composition or transformation. Legacy `profile.json` files are skipped during installation.

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
1. Reads profile directories from config/ (skips directories starting with `_`)
2. For each profile with AGENTS.md, removes existing version and copies fresh (skips profile.json)
3. Invokes sub-loaders for rules, subagents, and AGENTS.md

Note: Unlike claude-code which preserves existing profiles, cursor-agent replaces profiles on each install.

**Uninstall Behavior**: Profiles are never deleted during uninstall. Users manage their profiles via the registry and all customizations are preserved.

### Things to Know

**Self-contained profiles**: Each profile contains all content it needs directly. There is no mixin composition, inheritance, or conditional injection. This simplifies the architecture - profiles are copied as-is.

**AGENTS.md as validation marker**: A directory is only treated as a valid profile if it contains AGENTS.md. Directories without AGENTS.md are skipped.

**skipBuiltinProfiles for switch-profile**: When `config.skipBuiltinProfiles === true`, the `installProfiles()` function skips copying built-in profiles from the package entirely. This runtime-only flag is set by the switch-profile command (@/src/cli/commands/switch-profile/profiles.ts) to support the `seaweed download && seaweed switch-skillset` workflow where users download a specific profile from the registry and want only that profile active without installing all built-in profiles.

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
| Profile preservation | Replaced on install | Preserved (skipped if exists) |

### Directory Structure

```
profiles/
  config/
    amol/
      AGENTS.md        # Full workflow instructions
      nori.json        # {"name": "amol", "version": "1.0.0", "description": "..."}
      rules/           # All rules inlined
      subagents/       # All subagents inlined
    senior-swe/
      AGENTS.md
      nori.json
      rules/
      subagents/
    product-manager/
      AGENTS.md
      nori.json
      rules/
      subagents/
    none/
      AGENTS.md        # Minimal (empty/nearly-empty)
      nori.json        # {"name": "none", "version": "1.0.0"}
      rules/           # Base rules only
  agentsmd/            # AGENTS.md loader
  rules/
    loader.ts          # Copies rules to ~/.cursor/rules/
    rules.test.ts      # Validates YAML frontmatter
  subagents/
    loader.ts          # Copies subagents to ~/.cursor/subagents/
  loader.ts            # Profile installation
  loader.test.ts       # Tests for profile copying
  metadata.ts          # ProfileMetadata type and reader
  profileLoaderRegistry.ts  # Sub-loader registry
```

### Available Profiles

| Profile | Description |
|---------|-------------|
| amol | Opinionated workflow with TDD, structured planning, rule-based guidance |
| senior-swe | Dual-mode: "copilot" (interactive pair programming) or "full-send" (autonomous) |
| product-manager | High technical autonomy, product-focused questions, auto-creates PRs |
| none | Minimal infrastructure only, no behavioral modifications |

Created and maintained by Nori.
