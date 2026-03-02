# Noridoc: skill-download

Path: @/src/cli/commands/skill-download

### Overview

The skill-download command downloads and installs individual skill packages from the Nori registry into the skills directories of all configured default agents. Unlike `registry-download` which handles entire skillsets, this command targets single skills.

### How it fits into the larger codebase

Registered as `download-skill` via `@/src/cli/commands/noriSkillsetsCommands.ts`. It uses the same `@/api/registrar.js` API (via `getSkillPackument` and `downloadSkillTarball`) but against skill-specific endpoints. Skills are installed to each configured default agent's skills directory and persisted to the active skillset's `skills/` subdirectory. Manifest updates go through both `addSkillDependency` (in the skillset's `skills/` resolver) and `addSkillToNoriJson` (from `@/norijson/nori.js`).

The command resolves default agents via `getDefaultAgents({ config })` from `@/src/cli/config.ts`, then iterates over all returned agents. This is the same multi-agent broadcasting pattern used by `switchSkillset` (@/src/cli/commands/switch-skillset/) and the external install command (@/src/cli/commands/external/).

### Core Implementation

`skillDownloadMain` follows the same callback-driven flow pattern as registry-download. The `onSearch` callback supports namespaced packages (`org/skill-name`), explicit `--registry` URLs, and public registry fallback. It checks for existing installations via `.nori-version` files and uses semver comparison to determine if an update is available.

The `onDownload` callback extracts the tarball, writes `.nori-version` provenance, copies the skill to the skillset's `skills/` directory for persistence, applies template substitution on `.md` files, and updates both the skill dependency manifest and `nori.json`.

**Multi-agent broadcasting**: After installing to the primary agent's skills directory and applying template substitution, the command copies the skill directory to each additional default agent's skills directory, re-applying template substitution with each agent's own `installDir` so that `{{skills_dir}}` and similar placeholders resolve to agent-specific paths. Copy failures for secondary agents emit warnings but do not fail the command.

### Things to Know

The `--skillset` flag lets the user target a specific skillset for manifest updates; otherwise it defaults to the active skillset from config. Like registry-download, updates use an atomic swap with backup/restore on failure. The `--registry` flag and namespace prefix (`org/`) are mutually exclusive since the namespace implicitly determines the registry URL.

Created and maintained by Nori.
