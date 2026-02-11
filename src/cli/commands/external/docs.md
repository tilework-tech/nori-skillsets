# Noridoc: external

Path: @/src/cli/commands/external

### Overview

- Implements `nori-skillsets external <source>` CLI command
- Clones a GitHub repository, discovers SKILL.md files within it, and installs them as Nori skills to `~/.claude/skills/`
- Supports creating a brand-new skillset via `--new <name>` or targeting an existing one via `--skillset <name>`
- Provides an alternative skill sourcing path from arbitrary GitHub repos, complementing the registry-based `skill-download` command

### How it fits into the larger codebase

- Registered with Commander.js by `registerNoriSkillsetsExternalCommand` (called from @/src/cli/commands/noriSkillsetsCommands.ts) and also by `registerExternalSkillCommand` for the `external-skill` alias
- Follows the same dual-installation pattern as `skill-download`: skills are copied to both `~/.claude/skills/<name>/` (live, with template substitution applied) and `~/.nori/profiles/<skillset>/skills/<name>/` (raw copy for persistence across profile switches)
- Uses `getInstallDirs()` from @/src/utils/path.ts, `loadConfig()` from @/src/cli/config.ts, and `getAgentProfile()` to resolve the installation directory and active skillset -- same resolution logic as `skill-download`
- Uses `getClaudeSkillsDir()` and `getNoriProfilesDir()` from @/src/cli/features/claude-code/paths.ts for target directory paths
- Calls `addSkillToNoriJson()` to update skillset manifests, same as `skill-download`
- Uses `substituteTemplatePaths()` from @/src/cli/features/claude-code/template.ts for the live copy
- Does NOT use the registry API or `registrarApi` -- sources skills directly from git

### Core Implementation

**Data flow through the command:**

```
source string (URL or shorthand)
    |
    v
parseGitHubSource() --> { url, ref, subpath, skillFilter }
    |
    v
Resolve target skillset (--new, --skillset, or active profile)
    |
    v
cloneRepo() --> temp directory (shallow clone, 60s timeout)
    |
    v
discoverSkills() --> Array<DiscoveredSkill>
    |
    v
installSkill() for each selected skill
    |-- copyDirRecursive to ~/.claude/skills/<name>/
    |-- write nori.json provenance file
    |-- copyDirRecursive to profile's skills/ dir (raw)
    |-- applyTemplateSubstitutionToDir on live copy
    |-- addSkillToNoriJson
    |
    v
cleanupClone() (always runs via finally block)
```

**Skillset targeting** (`external.ts`): Three mutually exclusive modes determine where skills are tracked. The resolved target flows into `targetSkillset`, which controls whether profile-side copies and manifest updates happen.

| Mode | Flag | Behavior |
|---|---|---|
| Create new | `--new <name>` | Creates `~/.nori/profiles/<name>/` with empty `CLAUDE.md` and a `nori.json` (`{ name, version: "1.0.0" }`), then installs skills into it |
| Target existing | `--skillset <name>` | Validates the skillset exists (checks for `CLAUDE.md`), then installs skills into it |
| Active profile (default) | _(none)_ | Reads the active profile from config via `getAgentProfile()` and uses that if available |

When `--new` is used, the new directory is created before cloning begins. After creation, `targetSkillset` is set to the new name so the existing `installSkill()` flow handles copying skills and updating the manifest identically to any other skillset target.

**Source parsing** (`sourceParser.ts`): Accepts various GitHub URL formats and normalizes them into a `ParsedGitHubSource` with `url`, `ref`, `subpath`, and `skillFilter` fields. Rejects local paths and non-GitHub URLs.

| Input Format | Example | Result |
|---|---|---|
| HTTPS URL | `https://github.com/owner/repo` | url with `.git` suffix, no ref/subpath |
| Tree URL | `https://github.com/owner/repo/tree/main/path` | url, ref=`main`, subpath=`path` |
| Shorthand | `owner/repo` | HTTPS url constructed |
| Shorthand with subpath | `owner/repo/skills/foo` | url, subpath=`skills/foo` |
| @ filter | `owner/repo@my-skill` | url, skillFilter=`my-skill` |
| SSH | `git@github.com:owner/repo.git` | SSH url preserved |

**Skill discovery** (`skillDiscovery.ts`): Searches the cloned repo for SKILL.md files in priority order:
1. Root directory (returns immediately if found)
2. `skills/` and `.claude/skills/` subdirectories
3. Recursive fallback (up to 5 levels deep, skipping `node_modules`, `.git`, `dist`, `build`, `__pycache__`)

Skills are identified by parsing YAML frontmatter from SKILL.md files using regex (no `gray-matter` dependency). Both `name` and `description` fields are required. Deduplicates by skill name.

**Skill selection logic** when multiple skills are discovered:
- `--skill <name>` flag: install only the named skill
- `--all` flag: install all discovered skills
- `@skill-name` in source: filters discovered skills by name
- Single skill found: installs automatically
- Multiple skills, no filter: errors with a list of available skills

**Git cloning** (`gitClone.ts`): Shallow-clones (`--depth 1`) to a temp directory with a 60-second timeout. Classifies errors into timeout, authentication, and general failures with actionable messages. `cleanupClone()` validates the directory is within `os.tmpdir()` before deletion.

### Things to Know

- `--new` and `--skillset` are mutually exclusive; providing both produces an error. `--new` also validates that the name is non-empty and that no skillset with that name already exists (checked via `fs.access` on the directory).
- Each installed skill gets a `nori.json` provenance file containing: `name`, `source` (GitHub URL without `.git`), optional `ref` and `subpath`, and `installedAt` timestamp. This tracks where the skill was sourced from, unlike registry-downloaded skills which use `.nori-version`.
- Skill directory names are sanitized from the skill's `name` frontmatter field: lowercased, non-alphanumeric characters replaced with hyphens, leading/trailing dots and hyphens stripped, truncated to 255 characters.
- The `--ref` CLI flag takes precedence over any ref parsed from the source URL.
- Template substitution is applied only to `.md` files in the live copy (`~/.claude/skills/`), not the raw profile copy. This matches the behavior of `skill-download`.
- Unlike `skill-download`, this command does not use `registryAgentCheck` validation -- it works without any prior Nori installation beyond a resolved install directory.
- Manifest update failures (`addSkillToNoriJson`) are non-blocking, same as `skill-download`.

Created and maintained by Nori.
