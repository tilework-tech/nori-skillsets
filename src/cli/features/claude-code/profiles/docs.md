# Noridoc: Profiles

Path: @/src/cli/features/claude-code/profiles

### Overview

Profile system that provides complete, self-contained Nori configurations for Claude Code. Each profile directory contains all required content directly (CLAUDE.md, skills/, subagents/, slashcommands/) without any composition or inheritance. Profiles are obtained from the registry or created by users -- the package does not ship any built-in profiles. The `~/.nori/profiles/` directory serves as the single source of truth for all feature loaders. Active profile artifacts are then copied to `~/.claude/` (skills, agents, commands, CLAUDE.md) for Claude Code to consume.

### How it fits into the larger codebase

The profiles loader executes FIRST during installation (see @/src/cli/commands/install/install.ts). It ensures `~/.nori/profiles/` exists and configures permissions, but does not copy any profiles into it -- profiles arrive via registry download or user creation. All subsequent feature loaders (@/src/cli/features/claude-code/profiles/claudemd/loader.ts, @/src/cli/features/claude-code/profiles/skills/loader.ts, @/src/cli/features/claude-code/profiles/subagents/loader.ts, @/src/cli/features/claude-code/profiles/slashcommands/loader.ts) read from `~/.nori/profiles/{selectedProfile}/` to install their components. Profile switching is handled by @/src/cli/commands/switch-profile/profiles.ts which detects local changes to `~/.claude/` before overwriting, then updates `.nori-config.json` while preserving auth credentials, and re-runs installation. The statusline (@/src/cli/features/claude-code/statusline) displays the active profile name. The `/nori-switch-profile` slash command provides informational guidance for profile switching (directs user to run the terminal command).

### Core Implementation

**Profile Structure**: Each profile directory is self-contained with:
- `CLAUDE.md` (behavioral instructions, required for profile to be valid)
- `nori.json` (unified manifest with name, version, description, and optional dependencies)
- `skills/` (inline skill directories, each containing SKILL.md)
- `skills.json` (optional external skill dependencies)
- `subagents/` (subagent .md files)
- `slashcommands/` (slash command .md files)

Markdown files use template placeholders like `{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}` which are substituted with actual paths during installation by sub-loaders.

**Profile Metadata (nori.json)**: The `ProfileMetadata` type (@/src/cli/features/claude-code/profiles/metadata.ts) defines the unified manifest format:
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

The `readProfileMetadata()` function reads `nori.json` first, falling back to legacy `profile.json` for backward compatibility with older profiles. The `writeProfileMetadata()` function writes a `ProfileMetadata` object to `nori.json`. The `addSkillToNoriJson()` function reads an existing `nori.json` (or auto-creates one using the profile directory basename and version `"1.0.0"`), adds/updates a skill in `dependencies.skills`, and writes it back.

**Installation Manifest (manifest.ts)**: The manifest module (@/src/cli/features/claude-code/profiles/manifest.ts) tracks installed files for local change detection:

| Type | Purpose |
|------|---------|
| `FileManifest` | Stores SHA-256 hashes of all files in `~/.claude/` at installation time |
| `ManifestDiff` | Result of comparing current state against stored manifest (modified, added, deleted arrays) |

Key functions:
- `computeFileHash()` - Compute SHA-256 hash of a single file
- `computeDirectoryManifest()` - Recursively hash all files in a directory, returning a `FileManifest`
- `writeManifest()` / `readManifest()` - Persist/load manifest to/from `~/.nori/installed-manifest.json`
- `compareManifest()` - Compare a stored manifest against the current directory state, returning a `ManifestDiff`
- `hasChanges()` - Check if a `ManifestDiff` contains any changes
- `getManifestPath()` - Returns the path to the manifest file (`~/.nori/installed-manifest.json`)

The manifest is written after installation completes (via `writeInstalledManifest()` in @/src/cli/commands/install/install.ts) and checked before skillset switching (via `detectLocalChanges()` in @/src/cli/commands/switch-profile/profiles.ts).

**Skills as First-Class Citizens**: Skills can be declared in two ways:
1. **Inline skills**: Stored in profile's `skills/` folder, bundled with the profile
2. **External skills**: Declared in `skills.json` with semver version ranges, downloaded to profile's `skills/` folder

The `skills.json` format supports both simple version strings and object format:
```json
{
  "writing-plans": "^1.0.0",
  "systematic-debugging": { "version": "2.0.0" }
}
```

External skills are downloaded to the profile's own `skills/` directory by both `registry-download` (as profile dependencies) and `skill-download` (as standalone skill installs). This keeps profiles self-contained. External skills take precedence over inline skills when the same name exists.

**Installation Flow**: The `installProfiles()` function in @/src/cli/features/claude-code/profiles/loader.ts:
1. Creates the `~/.nori/profiles/` directory if it does not exist
2. Configures permissions for the profiles directory in `~/.claude/settings.json`

The `profiles/config/` directory in the package is empty -- no built-in profiles are shipped. First-time installations will have no profiles until the user downloads or creates one.

**Profile Lookup in Loaders**: All feature loaders use `getAgentProfile({ config, agentName: "claude-code" })` from @/src/cli/config.ts to determine the active profile name. This function returns the agent-specific profile from `config.agents["claude-code"].profile`, falling back to the legacy `config.profile` field for backwards compatibility.

**Profile Discovery**: The `claudeCodeAgent.listProfiles()` method in @/src/cli/features/claude-code/agent.ts scans `~/.nori/profiles/` for directories containing CLAUDE.md (supports both flat and namespaced org/profile layouts). The `switchProfile()` method validates the profile exists, loads current config, preserves auth credentials, updates the profile field, and prompts user to restart Claude Code.

### Things to Know

**~/.nori/profiles/ is the single source of truth**: All feature loaders read from `~/.nori/profiles/` instead of the npx package location. This enables users to create custom profiles or modify existing ones. The profiles loader must run FIRST to ensure this directory exists before other loaders attempt to read from it.

**No built-in profiles**: The package does not bundle any default profiles. The `profiles/config/` directory is empty. Users must download profiles from the registry or create their own. This means first-time installations will have no profiles until the user obtains one.

**Directory Separation**: Profiles are stored in `~/.nori/profiles/` rather than `~/.claude/profiles/`. The `.nori/` directory contains Nori's internal data (profile repository, installation manifest), while `.claude/` contains only Claude Code's native artifacts (skills, agents, commands, CLAUDE.md, settings.json).

**Self-contained profiles**: Each profile contains all content it needs directly. There is no mixin composition, inheritance, or conditional injection. The trade-off is content duplication across profiles that share common skills.

**Missing profile directories are valid**: Feature loaders (skills, slashcommands, subagents) treat missing profile directories as valid with zero items. When `fs.readdir()` fails on a profile's subdirectory (e.g., `~/.nori/profiles/none/skills/` doesn't exist), the install functions return early with an info message rather than throwing ENOENT.

**Profile preservation**: Profiles are NEVER deleted during install operations. All profiles remain in `~/.nori/profiles/`.

**CLAUDE.md as validation marker**: A directory is only a valid profile if it contains CLAUDE.md.

**Template placeholders in profile files**: Source markdown files use placeholders like `{{skills_dir}}` instead of hardcoded paths. Template substitution is applied by sub-loaders during installation via @/src/cli/features/claude-code/template.ts. The `substituteTemplatePaths()` function in template.ts expects its `installDir` parameter to be the `.claude` directory (e.g., `~/.claude`), NOT the `Config.installDir` value which is the parent directory (e.g., `~`). All callers must compute the `.claude` directory first using `getClaudeDir({ installDir: config.installDir })` from @/src/cli/features/claude-code/paths.ts before passing it to template substitution functions.

**Managed block marker idempotency**: The `insertClaudeMd()` function in @/src/cli/features/claude-code/profiles/claudemd/loader.ts strips any existing `# BEGIN NORI-AI MANAGED BLOCK` and `# END NORI-AI MANAGED BLOCK` markers from profile CLAUDE.md content before wrapping it with fresh markers. This ensures the final installed `~/.claude/CLAUDE.md` always has exactly one set of markers, even when the profile content was created by `captureExistingConfigAsProfile()` (which adds markers during capture). Without this stripping, captured profiles would end up with double-nested markers.

**Hook-intercepted slash commands**: Several global slash commands (`nori-switch-profile`, `nori-toggle-autoupdate`, etc.) are intercepted by the slash-command-intercept hook and executed directly without LLM processing.

**Global vs profile slash commands**: Slash commands are split between two loaders:
- **Global commands** (@/src/cli/features/claude-code/slashcommands/): Profile-agnostic utilities (nori-debug, nori-switch-profile, etc.)
- **Profile commands** (@/src/cli/features/claude-code/profiles/slashcommands/): Commands that vary by profile

**Installation manifest for change detection**: The manifest file (`~/.nori/installed-manifest.json`) stores SHA-256 hashes of all files installed to `~/.claude/`. This enables detection of local modifications before skillset switching. The manifest is only written for the `claude-code` agent. Manifest writing failures are non-fatal and do not block installation.

## Architecture

**Profile Source of Truth: `~/.nori/profiles/`**

```
~/.nori/
  profiles/
    my-skillset/         # Self-contained profile (downloaded or user-created)
      skills/           # Inline skills + downloaded external skills
        writing-plans/  # External skill downloaded by registry-download or skill-download
        using-skills/   # Inline skill bundled with profile
        ...
      skills.json       # External skill dependencies metadata (optional)
      subagents/
      slashcommands/
      CLAUDE.md
      nori.json         # Unified manifest (name, version, description, dependencies)
    myorg/
      org-profile/      # Namespaced profile from organization registry
        ...
  installed-manifest.json  # SHA-256 hashes of installed files for change detection

~/.claude/
  skills/             # Final installed skills (inline + external merged)
  agents/             # Copied from active profile
  commands/           # Copied from active profile + global commands
  CLAUDE.md           # Generated from active profile
  settings.json       # Claude settings with Nori permissions
```

### Install Flow

1. **Profiles loader runs FIRST**
   - Creates `~/.nori/profiles/` directory if it does not exist
   - Configures permissions in `~/.claude/settings.json`

2. **User selects profile**
   - Reads available profiles from `~/.nori/profiles/`
   - Shows only user-installed profiles (downloaded from registry or user-created)

3. **Feature loaders run**
   - Read profile configuration from `~/.nori/profiles/${selectedProfile}/`
   - Install CLAUDE.md, skills, slashcommands, subagents to `~/.claude/` from that profile

4. **Installation manifest written**
   - Computes SHA-256 hashes of all files in `~/.claude/`
   - Stores manifest at `~/.nori/installed-manifest.json`

### Skill Installation Flow

The skills loader (@/src/cli/features/claude-code/profiles/skills/loader.ts) installs skills in a single step:

1. **Install all skills**: Copy skills from profile's `skills/` folder to `~/.claude/skills/`
   - This includes both inline skills (bundled with profile) and external skills (downloaded by registry-download or skill-download)
   - Template placeholders are substituted during copy

External skills are downloaded to the profile's `skills/` directory by both the `registry-download` command (for profile dependencies declared in `nori.json`) and the `skill-download` command (for standalone skill installs). The skills loader treats all skills in the profile's `skills/` directory uniformly. When `skill-download` installs a skill, it updates two manifests: `skills.json` (used by the skill loader/resolver) and `nori.json` (the canonical profile manifest, via `addSkillToNoriJson()` from @/src/cli/features/claude-code/profiles/metadata.ts). Both updates are non-fatal -- download succeeds even if either manifest write fails.

The resolver module (@/src/cli/features/claude-code/profiles/skills/resolver.ts) provides read and write operations for skills.json:
- `parseSkillsJson()` - Parse skills.json content into dependency array
- `readSkillsJson()` - Read and parse skills.json from profile directory
- `writeSkillsJson()` - Write skills.json to a profile directory
- `addSkillDependency()` - Add or update a skill dependency in a profile's skills.json (used by `skill-download` to track downloaded skills)
- `resolveSkillVersion()` - Resolve semver version range to specific version

## Usage

```bash
npx nori-skillsets switch-skillset my-custom-profile
```

Or use `/nori-switch-profile` slash command in Claude Code.

## Validation

The `validate()` function checks:
- `~/.nori/profiles/` directory exists
- Profiles directory permissions are configured in settings.json


Created and maintained by Nori.
