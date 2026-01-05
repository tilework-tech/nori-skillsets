# Noridoc: Profiles

Path: @/src/cli/features/claude-code/profiles

### Overview

Profile system that provides complete, self-contained Nori configurations composed from modular mixins. Each profile is built by combining multiple mixins (\_base, \_docs, \_swe, \_paid) that contain skills/, subagents/, and slashcommands/ directories. Profiles are composed and copied to `~/.nori/profiles/` during installation and serve as the single source of truth for all feature loaders. Active profile artifacts are then copied to `~/.claude/` (skills, agents, commands, CLAUDE.md) for Claude Code to consume.

### How it fits into the larger codebase

The profiles loader executes FIRST in both interactive and non-interactive installation modes (see @/src/cli/commands/install/install.ts) to populate `~/.nori/profiles/` before any other loaders run. In interactive mode, @/src/cli/commands/install/install.ts prompts for profile selection by reading directories from @/src/cli/features/claude-code/profiles/config/, then saves the selection to `.nori-config.json` via @/src/cli/config.ts. All subsequent feature loaders (@/src/cli/features/claude-code/profiles/claudemd/loader.ts, @/src/cli/features/claude-code/profiles/skills/loader.ts, @/src/cli/features/claude-code/profiles/subagents/loader.ts, @/src/cli/features/claude-code/profiles/slashcommands/loader.ts) read from `~/.nori/profiles/{selectedProfile}/` to install their components. Profile switching is handled by @/src/cli/commands/switch-profile/profiles.ts which updates `.nori-config.json` while preserving auth credentials, then re-runs installation. The statusline (@/src/cli/features/claude-code/statusline) displays the active profile name. The `/nori-switch-profile` slash command enables in-conversation profile switching.

### Core Implementation

**Profile Structure**: Each profile directory contains `CLAUDE.md` (behavioral instructions) and `profile.json` (metadata with mixins configuration and optional builtin field). Profile content is composed from mixins defined in `_mixins/` directory: `_base` (essential skills/commands), `_docs` (documentation workflows), `_swe` (software engineering skills), and `_paid` (premium features). The `paid` mixin is automatically injected when auth credentials are present. Markdown files in profiles (CLAUDE.md, SKILL.md, subagent .md, slash command .md) use template placeholders like `{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}` which are substituted with actual paths during installation. Template substitution is applied by: @/src/cli/features/claude-code/profiles/claudemd/loader.ts (for CLAUDE.md), @/src/cli/features/claude-code/profiles/skills/loader.ts (for SKILL.md files), @/src/cli/features/claude-code/profiles/subagents/loader.ts (for subagent .md files), and @/src/cli/features/claude-code/profiles/slashcommands/loader.ts (for slash command .md files). All use substituteTemplatePaths() from @/src/cli/features/claude-code/template.ts.

**Built-in Profile Metadata**: All built-in profiles include `"builtin": true` in their profile.json files. This field is used by the uninstall process (@/src/cli/features/claude-code/profiles/loader.ts uninstallProfiles function) to distinguish built-in profiles from custom user profiles. During uninstall, only profiles with `"builtin": true` are removed. Profiles without this field (or with `"builtin": false`) are treated as custom and preserved.

**Built-in Profiles**: Several profiles ship with the package at @/src/cli/features/claude-code/profiles/config/:
- `senior-swe` - Co-pilot with high confirmation, the default profile
- `amol` - Full autonomy with frequent commits
- `product-manager` - Full autonomy for non-technical users
- `none` - Minimal profile with only base mixin and empty CLAUDE.md
- `onboarding-wizard` - Meta-profile that creates personalized profiles for first-time users

The default profile fallback `senior-swe` (from @/src/cli/config.ts getDefaultProfile()) is only used in interactive mode when an existing config has no profile field. Non-interactive installs require explicit `--profile` flag when no existing config is present.

**Onboarding Wizard Profile**: The `onboarding-wizard` is a "meta-profile" whose purpose is to create other profiles. It operates as an Installation Wizard with special instructions that bypass normal workflow (no git worktrees, no branches). The wizard asks users about:
1. Profile name
2. Autonomy level (high/moderate/pair programming)
3. Git workflow (worktrees/branches/ask each time)
4. Testing philosophy (strict TDD/preferred/minimal)
5. Documentation preferences (always/on request/none)
6. Communication tone (direct/balanced/supportive)

After collecting preferences, it generates a customized profile in `~/.claude/profiles/<profile-name>/` with a tailored CLAUDE.md based on the user's answers. Uses the same mixins as `senior-swe` (base, docs, swe). After creating a custom profile, users switch to it using `/nori-switch-profile`.

**Installation Flow**: The `installProfiles()` function in @/src/cli/features/claude-code/profiles/loader.ts reads profile directories from config/, loads profile.json metadata, dynamically injects the `paid` mixin if the user has auth credentials (checked via `isPaidInstall({ config })` from @/src/cli/config.ts), then composes the profile by merging content from all mixins in alphabetical order. Mixins are located in `config/_mixins/` with names like `_base`, `_docs`, `_swe`, `_paid`. Directories are merged (union of contents) while files use last-writer-wins. Profile-specific content (CLAUDE.md) is overlaid last. Built-in profiles are always overwritten during installation to receive updates. Custom profiles are preserved. The composed profiles are written to `~/.nori/profiles/`, then the profiles loader also configures permissions for this directory in `~/.claude/settings.json`.

**Profile Lookup in Loaders**: All feature loaders (claudemd, skills, slashcommands, subagents) use `getAgentProfile({ config, agentName: "claude-code" })` from @/src/cli/config.ts to determine the active profile name. This function returns the agent-specific profile from `config.agents["claude-code"].profile`, falling back to the legacy `config.profile` field for backwards compatibility. Direct access to `config.profile` is prohibited - it bypasses agent-specific profiles and causes bugs during switch-profile for non-claude-code agents.

**Profile Discovery**: @/src/cli/commands/switch-profile/profiles.ts `listProfiles()` scans `~/.nori/profiles/` for directories containing CLAUDE.md. `switchProfile()` validates the profile exists, loads current config from `.nori-config.json`, preserves auth credentials, updates `profile.baseProfile` field, saves back to disk, and prompts user to restart Claude Code.

**Loader Ordering**: Critical fix in commit e832083 ensures profiles loader runs before all other loaders in non-interactive mode by explicitly calling `profilesLoader.run()` first in @/src/cli/commands/install/install.ts, then filtering it from the remaining loaders array.

### Things to Know

**~/.nori/profiles/ is the single source of truth**: All feature loaders read from `~/.nori/profiles/` instead of the npx package location. This enables users to create custom profiles or modify built-in ones. The profiles loader must run FIRST to populate this directory before other loaders attempt to read from it. The separation from `~/.claude/` ensures Nori's profile repository doesn't conflict with Claude Code's native configuration files.

**Directory Separation**: Profiles are stored in `~/.nori/profiles/` rather than `~/.claude/profiles/`. The `.nori/` directory contains Nori's internal data (profile repository), while `.claude/` contains only Claude Code's native artifacts (skills, agents, commands, CLAUDE.md, settings.json). This architecture:
- Creates clear ownership of directories
- Avoids conflicts between Nori's managed data and Claude's configuration
- Allows Claude Code to read from `.claude/` without encountering Nori-internal files

**Migration from .claude/profiles to .nori/profiles**: Migration 20.0.0 in @/src/cli/features/migration.ts automatically removes the old `~/.claude/profiles/` directory during upgrade. The profiles loader then creates the new `~/.nori/profiles/` directory structure.

**Missing profile directories are valid**: Feature loaders (skills, slashcommands, subagents) treat missing profile directories as valid with zero items. When `fs.readdir()` fails on a profile's subdirectory (e.g., `~/.nori/profiles/none/skills/` doesn't exist), the install functions return early with an info message rather than throwing ENOENT. Validation returns `valid: true` with "No X configured for this profile". This allows minimal profiles (like "none") to omit any directory they don't need.

**Directory-based vs JSON-based**: PR #197 replaced the JSON preference system with directory-based profiles, deleting 8,296 lines of code. PR #208 introduced profile composition with single inheritance via `extends` field. This PR replaces single inheritance with mixin composition, where profiles declare multiple mixins in profile.json and the loader composes them in alphabetical precedence order.

**Custom profile preservation**: Built-in profiles are identified by the `"builtin": true` field in their profile.json files. During uninstall, the loader only removes profiles with `"builtin": true`, preserving any custom user profiles (those without the builtin field or with `"builtin": false`). This allows users to safely create custom profiles by copying built-in ones to `~/.nori/profiles/` and modifying them without losing their work during profile switches or upgrades.

**Skill installation testing**: Tests in @/src/cli/features/claude-code/profiles/skills/loader.test.ts verify that skills from all mixins are correctly installed. Each new skill in a mixin should have corresponding tests verifying: (1) the skill exists after installation for the appropriate tier (free/paid), (2) frontmatter is properly formatted with name and description fields, and (3) the skill is installed in the expected location. For example, the creating-skills skill has tests verifying it's installed for both free and paid tiers since it's in the _base mixin.

**CLAUDE.md as validation marker**: A directory is only a valid profile if it contains CLAUDE.md. This allows config/ to contain other files without treating them as profiles.

**Config separation**: Auth credentials and profile selection are separate fields in `.nori-config.json`. The `auth` object contains username/password/organizationUrl, while `profile.baseProfile` contains the profile name. This separation allows profile switching without re-authentication.

**Template placeholders in profile files**: Source markdown files use placeholders like `{{skills_dir}}` instead of hardcoded paths like `~/.claude/skills/`. This enables configurable installation directories - the same source files work for both home directory installations (`~/.claude`) and project-specific installations at custom paths. Placeholders are replaced during installation with tilde notation for home installs or absolute paths for custom installs.

**Hook-intercepted slash commands**: Several global slash commands (`nori-switch-profile`, `nori-toggle-autoupdate`, `nori-toggle-session-transcripts`, `nori-install-location`) are intercepted by the slash-command-intercept hook (@/src/cli/features/claude-code/hooks/config/slash-command-intercept.ts) and executed directly without LLM processing. These commands have TypeScript implementations in @/src/cli/features/claude-code/hooks/config/intercepted-slashcommands/. The corresponding `.md` files (now in @/src/cli/features/claude-code/slashcommands/config/) provide the `description` frontmatter for Claude Code's command palette and user-facing documentation.

**Global vs profile slash commands**: Slash commands are now split between two loaders:
- **Global commands** (@/src/cli/features/claude-code/slashcommands/): Profile-agnostic utilities installed to `~/.claude/commands/` regardless of profile selection. Examples: nori-debug, nori-switch-profile, nori-info, nori-toggle-autoupdate.
- **Profile commands** (@/src/cli/features/claude-code/profiles/slashcommands/): Commands from profile mixins that vary by profile. Examples: nori-init-docs (from _docs mixin), nori-sync-docs (from _docs-paid mixin).

**Custom skill creation workflow**: The creating-skills skill (in @/src/cli/features/claude-code/profiles/config/_mixins/_base/skills/creating-skills/SKILL.md) enables users to create custom skills that persist across sessions. Skills are written directly to `~/.nori/profiles/{profile}/skills/{skill-name}/` and become available after a profile switch using `/nori-switch-profile`. Custom skills in profiles do NOT require reinstallation - they're immediately available after switching to that profile. The skill guides users through: (1) gathering requirements (name, description, steps, guidelines, optional scripts), (2) selecting target profile from `~/.nori/profiles/`, (3) creating skill directory structure, (4) writing SKILL.md with proper YAML frontmatter (name and description fields), (5) optionally adding bundled TypeScript scripts (with caveats about manual bundling), (6) verifying creation, and (7) offering to switch profiles. The skill is available to all users (free and paid) since it's in the _base mixin.

**Profile name display**: The statusline shows the active profile name (commit 5da74b7), but hides it when not explicitly set (commit ae5c085).

**Mixin Composition**: Profiles specify mixins in profile.json as `{"mixins": {"base": {}, "docs": {}, "swe": {}}}`. The loader processes mixins in alphabetical order for deterministic precedence. When multiple mixins provide the same file, last writer wins. When multiple mixins provide the same directory, contents are merged (union). Conditional mixins are automatically injected based on user tier and profile categories (see @/src/cli/features/claude-code/profiles/loader.ts).

**Category-Specific Tier Mixins**: The loader supports multi-criteria mixin injection. When a paid user has a profile containing category mixins (e.g., `docs`, `swe`), the loader automatically injects corresponding tier-specific mixins (e.g., `docs-paid`, `swe-paid`) if they exist. This enables paid features that are specific to certain categories.

**Composition Example for Paid User**:

- Profile specifies: `{"mixins": {"base": {}, "docs": {}, "swe": {}}}`
- Loader injects: `paid`, `docs-paid`, `swe-paid`
- Final composition order: `base` → `docs` → `docs-paid` → `paid` → `swe` → `swe-paid`

**Mixin Categories**: Mixins use a two-tier naming convention: `{category}` for base features and `{category}-{tier}` for tier-specific features:

- `_base`: Core infrastructure (using-skills, creating-skills skills, web-search-researcher subagent). The creating-skills skill provides an interactive workflow for users to create custom skills, guiding them through requirements gathering, profile selection, directory creation, SKILL.md writing, optional script bundling, verification, and profile switching. Note: Global slash commands (nori-debug, nori-info, nori-switch-profile, nori-toggle-autoupdate, nori-modify-registry-auth, nori-modify-watchtower-auth, etc.) have been moved to the global slashcommands feature at @/src/cli/features/claude-code/slashcommands/ and are no longer part of profile mixins.
- `_docs`: Documentation workflows - free tier (updating-noridocs skill, nori-initial-documenter/nori-change-documenter subagents, nori-init-docs command). All documentation workflows follow a consistent pattern: update local docs.md files, then sync to remote server using nori-sync-docs skill in a single bulk operation.
- `_docs-paid`: Documentation workflows - paid tier (paid-write-noridoc, paid-read-noridoc, paid-list-noridocs, nori-sync-docs skills, nori-sync-docs slash command)
- `_swe`: Software engineering - free tier (12 skills like TDD/debugging/git-worktrees/building-ui-ux, 3 codebase-analysis subagents)
- `_swe-paid`: Software engineering - paid tier (reserved for future paid SWE features)
- `_paid`: Cross-category premium features (paid-recall, paid-memorize skills, knowledge-researcher subagent)

### Creating Category-Specific Tier Mixins

To add features that require multiple criteria (e.g., paid AND docs):

1. **Create mixin directory**: `src/cli/features/claude-code/profiles/config/_mixins/_{category}-{tier}/`
2. **Follow naming convention**: Use `{category}-{tier}` format (e.g., `_docs-paid`, `_swe-paid`)
3. **Structure matches other mixins**: Include `skills/`, `subagents/`, `slashcommands/` as needed
4. **Automatic injection**: No code changes needed - loader detects and injects based on:
   - User has required tier credentials (checked by `isPaidInstall({ config })`)
   - Profile includes the base category mixin (e.g., `docs` in mixins)

**Example**:

```
_mixins/
  _docs-paid/
    skills/
      paid-write-noridoc/
        SKILL.md
        script.ts
      paid-read-noridoc/
        SKILL.md
        script.ts
```

This mixin will only be injected for paid users whose profiles include the `docs` mixin.

## Usage

```bash
npx nori-ai@latest switch-profile senior-swe
npx nori-ai@latest switch-profile amol
npx nori-ai@latest switch-profile my-custom-profile
```

### Via Slash Command

Use `/nori-switch-profile` in Claude Code to:

- List available profiles from `~/.nori/profiles/`
- Switch to a specific profile

## How It Works

### Architecture

**Profile Source of Truth: `~/.nori/profiles/`**

All feature loaders (claudemd, skills, slashcommands, subagents) read from `~/.nori/profiles/${profileName}/`. This is the single source of truth. Active profile artifacts are then copied to `~/.claude/` for Claude Code to consume.

```
~/.nori/
  profiles/
    senior-swe/       # Composed profile (source of truth)
      skills/
      subagents/
      slashcommands/
      CLAUDE.md
    amol/
    ...

~/.claude/
  skills/             # Copied from active profile
  agents/             # Copied from active profile
  commands/           # Copied from active profile
  CLAUDE.md           # Generated from active profile
  settings.json       # Claude settings with Nori permissions
```

### Install Flow

1. **Profiles loader runs FIRST** (before profile selection)

   - Reads profile.json from each profile to get mixins configuration
   - Injects `paid` mixin dynamically if user has auth credentials
   - Composes profile by copying content from mixins in alphabetical order
   - Overlays profile-specific content (CLAUDE.md, profile.json)
   - Copies composed profiles to `~/.nori/profiles/`
   - Overwrites built-in profiles to ensure they're up-to-date
   - Leaves custom profiles untouched

2. **First-time install detection** (see @/src/cli/commands/install/install.ts generatePromptConfig)

   - If no existing `.nori-config.json` exists, this is a first-time install
   - User is offered two choices:
     - Option 1: Select a pre-built profile (continues to standard profile selection)
     - Option 2: Create a personalized profile via the onboarding wizard
   - If user chooses the wizard, the `onboarding-wizard` profile is automatically selected
   - The wizard runs on next Claude Code session, asking questions and generating a custom profile

3. **User selects profile** (for existing installs or if user chose "pre-built" in step 2)

   - Reads available profiles from `~/.nori/profiles/`
   - Shows both built-in and custom profiles

4. **Feature loaders run**
   - Read profile configuration from `~/.nori/profiles/${selectedProfile}/`
   - Install CLAUDE.md, skills, slashcommands, subagents to `~/.claude/` from that profile

### Profile Switching

When you run `npx nori-ai@latest switch-profile <name>`:

1. Validates profile exists in `~/.nori/profiles/`
2. Saves profile name to `.nori-config.json` (preserves auth credentials)
3. Runs `installMain({ nonInteractive: true, skipUninstall: true })` to apply changes
   - The `skipUninstall: true` parameter prevents the installer from running uninstall first
   - This preserves custom user profiles that would otherwise be removed during the uninstall step
   - Built-in profiles are still updated to their latest versions during installation

### Key Files

- `src/cli/features/claude-code/profiles/loader.ts` - Copies profile templates to `~/.nori/profiles/`
- `src/cli/commands/switch-profile/profiles.ts` - Profile switching logic
- `src/cli/commands/install/install.ts` - Install flow (runs profiles loader first)
- Feature loaders - Read from `~/.nori/profiles/${profileName}/`, install to `~/.claude/`

## Validation

The `validate()` function checks:

- `~/.nori/profiles/` directory exists
- Required built-in profiles (`senior-swe`, `amol`, `product-manager`, `documenter`, `none`) are present. Note: `onboarding-wizard` is a meta-profile and is not required for validation.
- Run with `npx nori-ai@latest check`

## Uninstallation

During `npx nori-ai@latest uninstall`, only built-in profiles (those with `"builtin": true` in profile.json) are removed. Custom user profiles are preserved. The `~/.nori/profiles/` directory itself is not deleted, ensuring custom profiles survive uninstall operations.
