# Noridoc: Profiles

Path: @/src/cli/features/cursor-agent/profiles

### Overview

Profile system that provides complete, self-contained Nori configurations for Cursor IDE composed from modular mixins. Each profile is built by combining multiple mixins (e.g., `_base`, `_swe`) that contain `rules/` directories. Profiles are composed and copied to `~/.cursor/profiles/` during installation.

### How it fits into the larger codebase

The profiles loader is the top-level loader registered with CursorLoaderRegistry (@/src/cli/features/cursor-agent/loaderRegistry.ts). During installation, it:

1. Reads profile directories from `config/` (ignoring internal `_mixins` directory)
2. Composes each profile by merging mixin content in alphabetical order
3. Copies composed profiles to `~/.cursor/profiles/`
4. Invokes sub-loaders via CursorProfileLoaderRegistry for rules, subagents, and AGENTS.md installation

The architecture mirrors claude-code's profile system (@/src/cli/features/claude-code/profiles/), using the same mixin composition pattern. Both systems use alphabetical ordering for deterministic precedence and support conditional tier-based mixin injection for paid users.

```
profilesLoader (loader.ts)
    |
    +-- Read profile.json metadata (metadata.ts)
    +-- Inject conditional mixins for paid users
    +-- Compose profile from mixins in alphabetical order
    +-- Copy to ~/.cursor/profiles/
    |
    +-- CursorProfileLoaderRegistry (profileLoaderRegistry.ts)
            |
            +-- rulesLoader (@/src/cli/features/cursor-agent/profiles/rules/loader.ts)
            +-- subagentsLoader (@/src/cli/features/cursor-agent/profiles/subagents/loader.ts)
            +-- agentsMdLoader (@/src/cli/features/cursor-agent/profiles/agentsmd/loader.ts)
```

### Core Implementation

**Profile Composition**: The `installProfiles()` function reads `profile.json` from each user-facing profile (directories not starting with `_`), loads the mixins configuration, and composes the profile by:

1. Reading mixin paths in alphabetical order via `getMixinPaths()`
2. Copying each mixin's content to the destination (directories merge, files use last-writer-wins)
3. Overlaying profile-specific content (AGENTS.md, profile.json)

**Conditional Mixin Injection**: The `injectConditionalMixins()` function adds mixins based on user tier:

- **Cross-category paid mixin** (`paid`): Added for all paid users
- **Category-specific tier mixins** (e.g., `swe-paid`): Added when user is paid AND profile contains the base category mixin

**Profile Metadata** (metadata.ts): The `ProfileMetadata` type and `readProfileMetadata()` function handle reading and parsing `profile.json` files. Metadata includes `name`, `description`, and `mixins` record.

### Things to Know

**Mixin naming convention**: Mixins use underscore prefix in the filesystem (`_base`, `_docs`, `_swe`) but are referenced without prefix in `profile.json` (`base`, `docs`, `swe`). The loader prepends the underscore when resolving paths.

**Composition order**: Mixins are composed in alphabetical order for deterministic precedence. For a profile with `{"mixins": {"base": {}, "docs": {}, "swe": {}}}`, the order is: `_base` -> `_docs` -> `_swe`. Profile-specific content (AGENTS.md) is always overlaid last.

**Paid user detection**: Uses `isPaidInstall({ config })` from @/src/cli/config.ts to check for auth credentials. Paid users automatically receive additional mixins without explicit profile.json changes.

**Category-specific tier mixin injection**: The loader automatically injects tier-specific mixins based on base category presence. Example for paid user with `swe` mixin:

| Profile declares | Loader injects | Final composition order |
|------------------|----------------|-------------------------|
| `base`, `swe` | `paid`, `swe-paid` | `base` -> `paid` -> `swe` -> `swe-paid` |

**Internal profiles are never installed**: Directories starting with `_` (like `_mixins`) are skipped during installation and never copied to `~/.cursor/profiles/`.

**AGENTS.md as validation marker**: A directory is only treated as a valid profile if it contains AGENTS.md. Directories without AGENTS.md are skipped.

**Template substitution in profile loaders**: All profile sub-loaders apply template substitution to `.md` files during the final copy stage (when copying from `~/.cursor/profiles/` to final destinations). This replaces placeholders like `{{rules_dir}}`, `{{subagents_dir}}` with actual paths. Substitution is applied by:
- **rulesLoader** - Uses `copyDirWithTemplateSubstitution()` when copying to `~/.cursor/rules/`
- **subagentsLoader** - Uses `copyDirWithTemplateSubstitution()` when copying to `~/.cursor/subagents/`
- **agentsMdLoader** - Uses `substituteTemplatePaths()` on AGENTS.md content before writing to project root

The key architectural insight: substitution happens at the final copy stage, not during intermediate staging to `~/.cursor/profiles/`. This ensures source files in profiles remain portable with placeholders intact.

**Rule file format**: Each RULE.md file uses Cursor's YAML frontmatter format:
```yaml
---
description: Use when [trigger condition] - [what it does]
alwaysApply: false
---
```
Rules use "Apply Intelligently" mode (no `globs` field) where Cursor's agent decides when to apply based on the description. The `{{rules_dir}}` template variable is used for cross-rule references.

**Subagents system**: Subagents provide Task tool-like functionality for Cursor, which lacks a built-in Task tool. The subagentsLoader copies `.md` files from the profile's `subagents/` directory to `~/.cursor/subagents/`. Each subagent is invoked via the `cursor-agent` CLI in headless mode: `cursor-agent -p "$(cat {{subagents_dir}}/subagent-name.md)\n---\nUSER REQUEST:\nYour prompt" --force`. The `using-subagents` rule in the `_base` mixin documents this invocation pattern. The `{{subagents_dir}}` template variable resolves to `~/.cursor/subagents/`. Subagents are contributed by multiple mixins (e.g., `_base` provides `nori-web-search-researcher`, `_docs` provides `nori-initial-documenter` and `nori-change-documenter`).

**Parallel to claude-code**: This implementation mirrors the claude-code mixin system in @/src/cli/features/claude-code/profiles/loader.ts. Key differences:

| Aspect | cursor-agent | claude-code |
|--------|--------------|-------------|
| Instructions file | AGENTS.md | CLAUDE.md |
| Feature directories | `rules/`, `subagents/` | `skills/`, `subagents/`, `slashcommands/` |
| Target directory | `~/.cursor/` | `~/.claude/` |
| Sub-loaders | rules, subagents, agentsmd | claudemd, skills, subagents, slashcommands |

**_testing export**: Internal functions (`isPaidUser`, `injectConditionalMixins`, `getMixinPaths`) are exported via `_testing` for unit test access.

### Directory Structure

```
profiles/
  config/
    _mixins/
      _base/
        rules/
          using-rules/           # Rule usage guidance
            RULE.md
          using-subagents/       # Subagent invocation documentation
            RULE.md
        subagents/               # Subagent prompt files
          nori-web-search-researcher.md
      _docs/
        rules/
          updating-noridocs/     # Documentation workflow rule
            RULE.md
        subagents/               # Documentation subagent prompt files
          nori-initial-documenter.md
          nori-change-documenter.md
      _swe/
        rules/                   # Software engineering rules (mirrors claude-code skills)
          test-driven-development/
          systematic-debugging/
          brainstorming/
          ...
    amol/
      AGENTS.md        # Full workflow instructions (base+docs+swe)
      profile.json     # {"name": "amol", "mixins": {"base": {}, "docs": {}, "swe": {}}}
    senior-swe/
      AGENTS.md        # Dual-mode: copilot (interactive) or full-send (autonomous)
      profile.json     # {"name": "senior-swe", "mixins": {"base": {}, "docs": {}, "swe": {}}}
    product-manager/
      AGENTS.md        # PM-focused: technical autonomy, product questions
      profile.json     # {"name": "product-manager", "mixins": {"base": {}, "docs": {}, "swe": {}}}
    none/
      AGENTS.md        # Minimal (empty/nearly-empty)
      profile.json     # {"name": "none", "mixins": {"base": {}}} (base only)
  agentsmd/            # AGENTS.md loader
  rules/
    loader.ts          # Copies rules to ~/.cursor/rules/
    rules.test.ts      # Validates YAML frontmatter and profile structure
  subagents/
    loader.ts          # Copies subagents to ~/.cursor/subagents/
  loader.ts            # Profile composition and installation
  loader.test.ts       # Tests for mixin composition
  metadata.ts          # ProfileMetadata type and reader
  profileLoaderRegistry.ts  # Sub-loader registry
```

### Available Profiles

| Profile | Mixins | Description |
|---------|--------|-------------|
| amol | base, docs, swe | Opinionated workflow with TDD, structured planning, rule-based guidance |
| senior-swe | base, docs, swe | Dual-mode: "copilot" (interactive pair programming) or "full-send" (autonomous) |
| product-manager | base, docs, swe | High technical autonomy, product-focused questions, auto-creates PRs |
| none | base | Minimal infrastructure only, no behavioral modifications |

### Available Mixins

| Mixin | Contents | Description |
|-------|----------|-------------|
| `_base` | `using-rules` rule, `using-subagents` rule, `nori-web-search-researcher` subagent | Core infrastructure for rules and subagents |
| `_docs` | `updating-noridocs` rule, `nori-initial-documenter` subagent, `nori-change-documenter` subagent | Documentation workflows for creating and updating docs.md files |
| `_swe` | Software engineering rules (TDD, debugging, brainstorming, etc.) | Rule-based guidance mirroring claude-code skills |

Created and maintained by Nori.
