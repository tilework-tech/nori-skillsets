# Noridoc: skill-download

Path: @/src/cli/commands/skill-download

### Overview

The skill-download command downloads and installs individual skill packages from the Nori registry into the active Claude Code skills directory. Unlike `registry-download` which handles entire skillsets, this command targets single skills.

### How it fits into the larger codebase

Registered as `download-skill` via `@/src/cli/commands/noriSkillsetsCommands.ts`. It uses the same `@/api/registrar.js` API (via `getSkillPackument` and `downloadSkillTarball`) but against skill-specific endpoints. Skills are installed to the live Claude skills directory (`@/cli/features/claude-code/paths.js` for Claude-specific paths) and persisted to the active skillset's `skills/` subdirectory. Manifest updates go through both `addSkillDependency` (in the skillset's `skills/` resolver) and `addSkillToNoriJson` (from `@/cli/features/skillsetMetadata.js`).

### Core Implementation

`skillDownloadMain` follows the same callback-driven flow pattern as registry-download. The `onSearch` callback supports namespaced packages (`org/skill-name`), explicit `--registry` URLs, and public registry fallback. It checks for existing installations via `.nori-version` files and uses semver comparison to determine if an update is available.

The `onDownload` callback extracts the tarball, writes `.nori-version` provenance, copies the skill to the skillset's `skills/` directory for persistence, applies template substitution on `.md` files, and updates both the skill dependency manifest and `nori.json`.

### Things to Know

The `--skillset` flag lets the user target a specific skillset for manifest updates; otherwise it defaults to the active skillset from config. Like registry-download, updates use an atomic swap with backup/restore on failure. The `--registry` flag and namespace prefix (`org/`) are mutually exclusive since the namespace implicitly determines the registry URL.

Created and maintained by Nori.
