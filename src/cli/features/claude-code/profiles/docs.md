# Noridoc: Profiles

Path: @/src/cli/features/claude-code/profiles

### Overview

The profiles module manages Nori skillsets (profiles) for the claude-code agent. Profiles are self-contained bundles of skills, subagents, slash commands, and behavioral instructions that get installed into `~/.claude/`. This module handles profile structure, metadata, installation manifest tracking, skill resolution, and the installation flow.

### How it fits into the larger codebase

- Feature loaders throughout @/src/cli/features/claude-code/ read from profile directories in `~/.nori/profiles/` to install content into `~/.claude/`. This profiles module ensures those directories exist and are properly structured.
- The CLI commands layer (@/src/cli/commands/) invokes profile operations: `install` triggers the installation flow and writes the manifest, `switch-skillset` reads the manifest for change detection, and `registry-download`/`skill-download` populate profile directories with external content.
- Profile discovery (`listProfiles()` in @/src/cli/features/managedFolder.ts) and profile switching (`switchProfile()` on `claudeCodeAgent`) depend on the `nori.json` marker that this module defines and reads.

### Core Implementation

**Profile Structure**: Each profile directory is self-contained with:
- `CLAUDE.md` (behavioral instructions content, installed to `~/.claude/CLAUDE.md`)
- `nori.json` (unified manifest and profile marker; contains name, version, description, and optional dependencies)
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

**Installation Manifest (manifest.ts)**: The manifest module (@/src/cli/features/claude-code/profiles/manifest.ts) tracks installed files for local change detection. The manifest uses a **whitelist approach**: only Nori-managed paths within `~/.claude/` are tracked, ignoring Claude Code's own runtime directories (e.g., `debug/`, `todos/`, `projects/`, `plugins/`).

| Constant | Values | Purpose |
|----------|--------|---------|
| `MANAGED_FILES` | `CLAUDE.md`, `settings.json`, `nori-statusline.sh` | Root-level files Nori installs |
| `MANAGED_DIRS` | `skills`, `commands`, `agents` | Directories whose contents Nori installs (recursively tracked) |

| Type | Purpose |
|------|---------|
| `FileManifest` | Stores SHA-256 hashes of Nori-managed files in `~/.claude/` at installation time |
| `ManifestDiff` | Result of comparing current state against stored manifest (modified, added, deleted arrays) |

The `collectFiles()` function filters at the top level only -- when scanning `~/.claude/`, it skips any file or directory not in the whitelist. Within whitelisted directories (e.g., `skills/`), all nested files are collected recursively without further filtering. The `isManagedPath()` helper checks whether a relative path is a whitelisted root file or falls under a whitelisted directory by examining the first path segment.

The `compareManifest()` function also uses `isManagedPath()` when iterating over stored manifest entries, skipping any entry for a non-whitelisted path. This handles the transition from older manifests that tracked everything in `~/.claude/` -- old entries for runtime directories like `debug/` or `todos/` are silently ignored rather than reported as "deleted".

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

No built-in profiles are shipped with the package. First-time installations will have no profiles until the user downloads or creates one.

**Profile Lookup in Loaders**: All feature loaders use `getAgentProfile({ config, agentName: "claude-code" })` from @/src/cli/config.ts to determine the active profile name. This function returns the agent-specific profile from `config.agents["claude-code"].profile`, falling back to the legacy `config.profile` field for backwards compatibility.

**Profile Discovery**: The `listProfiles()` function in @/src/cli/features/managedFolder.ts scans `~/.nori/profiles/` for directories containing `nori.json` (supports both flat and namespaced org/profile layouts). This is an agent-agnostic utility imported directly by CLI commands. The `switchProfile()` method on `claudeCodeAgent` validates the profile exists, loads current config, preserves auth credentials, updates the profile field, and prompts user to restart Claude Code.

### Things to Know

**~/.nori/profiles/ is the single source of truth**: All feature loaders read from `~/.nori/profiles/` instead of the npx package location. This enables users to create custom profiles or modify existing ones. The profiles loader must run FIRST to ensure this directory exists before other loaders attempt to read from it.

**No built-in profiles**: The package does not bundle any default profiles. Users must download profiles from the registry or create their own. This means first-time installations will have no profiles until the user obtains one.

**Directory Separation**: Profiles are stored in `~/.nori/profiles/` rather than `~/.claude/profiles/`. The `.nori/` directory contains Nori's internal data (profile repository, installation manifest), while `.claude/` contains only Claude Code's native artifacts (skills, agents, commands, CLAUDE.md, settings.json).

**Self-contained profiles**: Each profile contains all content it needs directly. There is no mixin composition, inheritance, or conditional injection. The trade-off is content duplication across profiles that share common skills.

**Missing profile directories are valid**: Feature loaders (skills, slashcommands, subagents) treat missing profile directories as valid with zero items. When `fs.readdir()` fails on a profile's subdirectory (e.g., `~/.nori/profiles/none/skills/` doesn't exist), the install functions return early with an info message rather than throwing ENOENT.

**Profile preservation**: Profiles are NEVER deleted during install operations. All profiles remain in `~/.nori/profiles/`.

**nori.json as validation marker**: A directory is only a valid profile if it contains `nori.json`. The `nori.json` file serves as both the unified profile manifest and the profile presence marker. `CLAUDE.md` files in profiles are purely behavioral instructions content, not structural markers.

**Template placeholders in profile files**: Source markdown files use placeholders like `{{skills_dir}}` instead of hardcoded paths. Template substitution is applied by sub-loaders during installation via @/src/cli/features/claude-code/template.ts. The `substituteTemplatePaths()` function in template.ts expects its `installDir` parameter to be the `.claude` directory (e.g., `~/.claude`), NOT the `Config.installDir` value which is the parent directory (e.g., `~`). All callers must compute the `.claude` directory first using `getClaudeDir({ installDir: config.installDir })` from @/src/cli/features/claude-code/paths.ts before passing it to template substitution functions.

**Managed block marker idempotency**: The `insertClaudeMd()` function in @/src/cli/features/claude-code/profiles/claudemd/loader.ts strips any existing `# BEGIN NORI-AI MANAGED BLOCK` and `# END NORI-AI MANAGED BLOCK` markers from profile CLAUDE.md content before wrapping it with fresh markers. This ensures the final installed `~/.claude/CLAUDE.md` always has exactly one set of markers, even when the profile content was created by `captureExistingConfigAsProfile()` (which adds markers during capture). Without this stripping, captured profiles would end up with double-nested markers.

**Profile slash commands**: Profile-specific slash commands are installed by @/src/cli/features/claude-code/profiles/slashcommands/ loader from the active profile's slashcommands/ directory.

**Manifest whitelist for change detection**: The manifest file (`~/.nori/installed-manifest.json`) only tracks Nori-managed paths within `~/.claude/` (`MANAGED_FILES` and `MANAGED_DIRS` in manifest.ts). Claude Code creates many runtime directories (`debug/`, `todos/`, `projects/`, `plugins/`, `session-env/`, `shell-snapshots/`, `statsig/`, `telemetry/`, `tasks/`, `cache/`, etc.) that change between sessions. The whitelist prevents these from appearing as false positive "local changes detected" during skillset switching. The `compareManifest()` function also filters out stale entries from older manifests that tracked non-whitelisted paths, enabling graceful transition without requiring users to reinstall.

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
  installed-manifest.json  # SHA-256 hashes of Nori-managed files for change detection

~/.claude/
  skills/             # Final installed skills (Nori-managed, tracked in manifest)
  agents/             # Copied from active profile (Nori-managed, tracked in manifest)
  commands/           # Copied from active profile + global commands (Nori-managed, tracked in manifest)
  CLAUDE.md           # Generated from active profile (Nori-managed, tracked in manifest)
  settings.json       # Claude settings with Nori permissions (Nori-managed, tracked in manifest)
  nori-statusline.sh  # Statusline script (Nori-managed, tracked in manifest)
  debug/              # Claude Code runtime (NOT tracked by manifest)
  todos/              # Claude Code runtime (NOT tracked by manifest)
  projects/           # Claude Code runtime (NOT tracked by manifest)
  ...                 # Other Claude Code runtime dirs (NOT tracked by manifest)
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
   - Computes SHA-256 hashes of Nori-managed files in `~/.claude/` (whitelist-filtered)
   - Stores manifest at `~/.nori/installed-manifest.json`

### Skill Installation Flow

The skills loader (@/src/cli/features/claude-code/profiles/skills/loader.ts) installs skills in a single step:

1. **Install all skills**: Copy skills from profile's `skills/` folder to `~/.claude/skills/`
   - This includes both inline skills (bundled with profile) and external skills (downloaded by registry-download or skill-download)
   - Template placeholders are substituted during copy

The external skill system uses both `skills.json` (legacy dependency format) and `nori.json` `dependencies.skills` (unified format). Skills are downloaded from the Nori registry and stored in the profile's own `skills/` directory.

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


Created and maintained by Nori.
