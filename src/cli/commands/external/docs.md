# Noridoc: external

Path: @/src/cli/commands/external

### Overview

The external command installs skills from GitHub repositories into the local Nori skills directories of all configured default agents. It handles parsing GitHub URLs, cloning repos to temp directories, discovering SKILL.md files inside them, and copying the skill folders into the active skillset.

### How it fits into the larger codebase

This command is registered via `@/src/cli/commands/noriSkillsetsCommands.ts`. It writes skills to each configured default agent's skills directory and persists copies into the skillset's `skills/` subfolder under `~/.nori/profiles/`. It updates the skillset's `nori.json` manifest through `@/norijson/nori.js`. Template path substitution is applied to `.md` files via `@/cli/features/template.js`. When multiple skills are found and the user has not specified `--skill` or `--all`, it prompts for skill type selection through `@/cli/prompts/flows/externalSkillType.js`.

The command resolves default agents via `getDefaultAgents({ config })` from `@/src/cli/config.ts`, then iterates over all returned agents. This is the same multi-agent broadcasting pattern used by `switchSkillset` (@/src/cli/commands/switch-skillset/) and the skill-download command (@/src/cli/commands/skill-download/).

### Core Implementation

The pipeline in `externalMain` is: parse source -> resolve install/skillset targets -> resolve default agents -> clone repo -> discover skills -> select which to install -> resolve skill types (inline vs extract) -> install each skill (broadcasting to all agents) -> cleanup clone.

`sourceParser.ts` converts various GitHub URL formats (full HTTPS, SSH, `owner/repo` shorthand, `owner/repo@skill` filter syntax) into a `ParsedGitHubSource` with `url`, `ref`, `subpath`, and `skillFilter` fields.

`skillDiscovery.ts` searches the cloned repo for directories containing `SKILL.md` files with valid YAML frontmatter (`name` and `description`). It checks the root first (returning immediately if the repo itself is a single skill), then performs a recursive search up to 5 levels deep. Results are deduplicated by skill name. The discovery is agent-agnostic -- it finds skills purely by searching for SKILL.md files rather than relying on agent-specific directory conventions.

`gitClone.ts` performs a shallow `git clone --depth 1` to a temp directory with a 60-second timeout. `cleanupClone` validates the path is within the system temp directory before deletion to prevent accidental removal of non-temp paths.

**Multi-agent broadcasting**: The `installSkill` function accepts an `agents` array parameter. It installs to the primary agent's skills directory first, applies template substitution, then copies the skill directory to each additional agent's skills directory with agent-specific template substitution. Copy failures for secondary agents emit warnings via `log.warn` but do not fail the install. The `externalMain` function resolves the agents list and ensures all agents' skills directories exist before cloning begins.

### Things to Know

Each installed skill gets a `nori.json` provenance file recording source URL, ref, subpath, and installation timestamp. The skill type (`"skill"` or `"inlined-skill"`) is determined by user prompt or the `--inline`/`--extract` flags, and these are mutually exclusive. The `--new` and `--skillset` flags are also mutually exclusive; `--new` creates a fresh skillset first via `createEmptySkillset`.

Created and maintained by Nori.
