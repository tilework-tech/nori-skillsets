# Noridoc: Profiles

Path: @/src/cli/features/claude-code/profiles

### Overview

Profile system that provides complete, self-contained Nori configurations for Claude Code. Each profile directory contains all required content directly (CLAUDE.md, skills/, subagents/, slashcommands/) without any composition or inheritance. Profiles are copied to `~/.nori/profiles/` during installation and serve as the single source of truth for all feature loaders. Active profile artifacts are then copied to `~/.claude/` (skills, agents, commands, CLAUDE.md) for Claude Code to consume.

### How it fits into the larger codebase

The profiles loader executes FIRST in both interactive and non-interactive installation modes (see @/src/cli/commands/install/install.ts) to populate `~/.nori/profiles/` before any other loaders run. In interactive mode, @/src/cli/commands/install/install.ts prompts for profile selection by reading directories from @/src/cli/features/claude-code/profiles/config/, then saves the selection to `.nori-config.json` via @/src/cli/config.ts. All subsequent feature loaders (@/src/cli/features/claude-code/profiles/claudemd/loader.ts, @/src/cli/features/claude-code/profiles/skills/loader.ts, @/src/cli/features/claude-code/profiles/subagents/loader.ts, @/src/cli/features/claude-code/profiles/slashcommands/loader.ts) read from `~/.nori/profiles/{selectedProfile}/` to install their components. Profile switching is handled by @/src/cli/commands/switch-profile/profiles.ts which updates `.nori-config.json` while preserving auth credentials, then re-runs installation. The statusline (@/src/cli/features/claude-code/statusline) displays the active profile name. The `/nori-switch-profile` slash command enables in-conversation profile switching.

### Core Implementation

**Profile Structure**: Each profile directory is self-contained with:
- `CLAUDE.md` (behavioral instructions, required for profile to be valid)
- `profile.json` (metadata with name, description, and builtin flag)
- `skills/` (inline skill directories, each containing SKILL.md)
- `skills.json` (optional external skill dependencies)
- `subagents/` (subagent .md files)
- `slashcommands/` (slash command .md files)

Profiles are copied directly to `~/.nori/profiles/` without any composition or transformation. Markdown files use template placeholders like `{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}` which are substituted with actual paths during installation by sub-loaders.

**Skills as First-Class Citizens**: Skills can be declared in two ways:
1. **Inline skills**: Stored in profile's `skills/` folder, bundled with the profile
2. **External skills**: Declared in `skills.json` with semver version ranges, installed from `~/.nori/skills/`

The `skills.json` format supports both simple version strings and object format:
```json
{
  "writing-plans": "^1.0.0",
  "systematic-debugging": { "version": "2.0.0" }
}
```

External skills are resolved from `~/.nori/skills/` (the skill cache) and take precedence over inline skills when the same name exists. This enables skill reuse across profiles and independent versioning.

**Paid Skills and Subagents**: Skills and subagents with a `paid-` prefix are tier-gated:
- For paid users: the `paid-` prefix is stripped when copying (e.g., `paid-recall/` becomes `recall/`)
- For free users: `paid-` prefixed items are skipped entirely
This logic is implemented in @/src/cli/features/claude-code/profiles/skills/loader.ts and @/src/cli/features/claude-code/profiles/subagents/loader.ts.

**Built-in Profile Metadata**: All built-in profiles include `"builtin": true` in their profile.json files. This field is informational only - it indicates which profiles shipped with Nori. Profiles are NEVER deleted during install or uninstall regardless of this field's value.

**Built-in Profiles**: Several profiles ship with the package at @/src/cli/features/claude-code/profiles/config/:
- `senior-swe` - Co-pilot with high confirmation, the default profile
- `amol` - Full autonomy with frequent commits
- `product-manager` - Full autonomy for non-technical users
- `documenter` - Documentation-focused profile
- `none` - Minimal profile with only base capabilities
- `onboarding-wizard-questionnaire` - Meta-profile that creates personalized profiles for first-time users

**Installation Flow**: The `installProfiles()` function in @/src/cli/features/claude-code/profiles/loader.ts:
1. Reads profile directories from config/ (skips directories starting with `_`)
2. For each profile with CLAUDE.md, checks if it already exists in `~/.nori/profiles/`
3. Skips existing profiles (logs "use registry to update") to preserve user customizations
4. Copies new profiles directly (no composition needed)
5. Configures permissions for the profiles directory in `~/.claude/settings.json`

**Profile Lookup in Loaders**: All feature loaders use `getAgentProfile({ config, agentName: "claude-code" })` from @/src/cli/config.ts to determine the active profile name. This function returns the agent-specific profile from `config.agents["claude-code"].profile`, falling back to the legacy `config.profile` field for backwards compatibility.

**Profile Discovery**: @/src/cli/commands/switch-profile/profiles.ts `listProfiles()` scans `~/.nori/profiles/` for directories containing CLAUDE.md. `switchProfile()` validates the profile exists, loads current config, preserves auth credentials, updates the profile field, and prompts user to restart Claude Code.

### Things to Know

**~/.nori/profiles/ is the single source of truth**: All feature loaders read from `~/.nori/profiles/` instead of the npx package location. This enables users to create custom profiles or modify built-in ones. The profiles loader must run FIRST to populate this directory before other loaders attempt to read from it.

**Directory Separation**: Profiles are stored in `~/.nori/profiles/` rather than `~/.claude/profiles/`. The `.nori/` directory contains Nori's internal data (profile repository), while `.claude/` contains only Claude Code's native artifacts (skills, agents, commands, CLAUDE.md, settings.json).

**Self-contained profiles**: Each profile contains all content it needs directly. There is no mixin composition, inheritance, or conditional injection. This simplifies the architecture - profiles are copied as-is to `~/.nori/profiles/`. The trade-off is content duplication across profiles that share common skills.

**Missing profile directories are valid**: Feature loaders (skills, slashcommands, subagents) treat missing profile directories as valid with zero items. When `fs.readdir()` fails on a profile's subdirectory (e.g., `~/.nori/profiles/none/skills/` doesn't exist), the install functions return early with an info message rather than throwing ENOENT.

**Profile preservation**: Profiles are NEVER deleted during install or uninstall operations. During install, existing profile directories are skipped entirely. During uninstall, only permissions configuration in `~/.claude/settings.json` is removed - all profiles remain in `~/.nori/profiles/`.

**CLAUDE.md as validation marker**: A directory is only a valid profile if it contains CLAUDE.md. This allows config/ to contain other directories (like internal configuration) without treating them as profiles.

**Template placeholders in profile files**: Source markdown files use placeholders like `{{skills_dir}}` instead of hardcoded paths. Template substitution is applied by sub-loaders during installation via @/src/cli/features/claude-code/template.ts.

**Hook-intercepted slash commands**: Several global slash commands (`nori-switch-profile`, `nori-toggle-autoupdate`, etc.) are intercepted by the slash-command-intercept hook and executed directly without LLM processing.

**Global vs profile slash commands**: Slash commands are split between two loaders:
- **Global commands** (@/src/cli/features/claude-code/slashcommands/): Profile-agnostic utilities (nori-debug, nori-switch-profile, etc.)
- **Profile commands** (@/src/cli/features/claude-code/profiles/slashcommands/): Commands that vary by profile

## Architecture

**Profile Source of Truth: `~/.nori/profiles/`**

```
~/.nori/
  profiles/
    senior-swe/         # Self-contained profile
      skills/           # Inline skills
      skills.json       # External skill dependencies (optional)
      subagents/
      slashcommands/
      CLAUDE.md
      profile.json
    amol/
    ...
  skills/               # External skill cache (downloaded skills)
    writing-plans/
    systematic-debugging/
    ...

~/.claude/
  skills/             # Final installed skills (inline + external merged)
  agents/             # Copied from active profile
  commands/           # Copied from active profile + global commands
  CLAUDE.md           # Generated from active profile
  settings.json       # Claude settings with Nori permissions
```

### Install Flow

1. **Profiles loader runs FIRST** (before profile selection)
   - Checks if each profile already exists in `~/.nori/profiles/`
   - Skips existing profiles (logs "use registry to update")
   - Copies new profiles directly from config/
   - Never overwrites existing profiles

2. **User selects profile** (interactive mode)
   - Reads available profiles from `~/.nori/profiles/`
   - Shows both built-in and custom profiles

3. **Feature loaders run**
   - Read profile configuration from `~/.nori/profiles/${selectedProfile}/`
   - Install CLAUDE.md, skills, slashcommands, subagents to `~/.claude/` from that profile

### Skill Installation Flow

The skills loader (@/src/cli/features/claude-code/profiles/skills/loader.ts) installs skills in two steps:

1. **Install inline skills**: Copy skills from profile's `skills/` folder to `~/.claude/skills/`
   - Paid-prefixed skills are handled based on tier (stripped prefix for paid, skipped for free)
   - Template placeholders are substituted during copy

2. **Install external skills**: Read `skills.json` and copy matching skills from `~/.nori/skills/`
   - External skills overwrite inline skills with the same name
   - Template placeholders are substituted during copy
   - Missing external skills log a warning but don't fail installation

The resolver module (@/src/cli/features/claude-code/profiles/skills/resolver.ts) provides:
- `parseSkillsJson()` - Parse skills.json into dependency array
- `readSkillsJson()` - Read and parse skills.json from profile directory
- `resolveSkillVersion()` - Resolve semver version range to specific version
- `isSkillInstalled()` - Check if skill exists in `~/.nori/skills/`

## Usage

```bash
npx nori-ai@latest switch-profile senior-swe
npx nori-ai@latest switch-profile amol
npx nori-ai@latest switch-profile my-custom-profile
```

Or use `/nori-switch-profile` slash command in Claude Code.

## Validation

The `validate()` function checks:
- `~/.nori/profiles/` directory exists
- Required built-in profiles are present with CLAUDE.md and profile.json
- Profiles directory permissions are configured in settings.json

Run with `npx nori-ai@latest check`

Created and maintained by Nori.
