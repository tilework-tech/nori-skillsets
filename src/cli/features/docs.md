# Noridoc: features

Path: @/src/cli/features

### Overview

The features directory contains the agent abstraction layer and all agent-specific feature implementations. It defines the `AgentConfig` type (pure data struct) and `Loader` interface that allow the system to support multiple AI coding agents. Shared handler functions in `@/src/cli/features/shared/agentHandlers.ts` provide all behavioral operations (install, remove, detect, capture, etc.) that accept an `AgentConfig` as a parameter. Agent-specific implementations (Claude Code and Cursor) export `AgentConfig` objects with their data, and the shared handlers operate on them generically.

### How it fits into the larger codebase

The `AgentRegistry` singleton is the central entry point used by CLI commands (e.g., `@/src/cli/commands/init`) to look up agent configurations. CLI commands call shared handler functions from `@/src/cli/features/shared/agentHandlers.ts`, passing the `AgentConfig` as a parameter. The `managedFolder.ts` module provides agent-agnostic skillset discovery by scanning `~/.nori/profiles/` for directories containing `nori.json` manifests, and is used by commands that need to list available skillsets.

The features directory sits between the CLI commands (@/src/cli/commands/) and agent configurations (@/src/cli/features/claude-code/, @/src/cli/features/cursor-agent/). CLI commands use the AgentRegistry to look up the agent configuration by name, then pass it to shared handler functions for all operations.

```
CLI Commands (install, switch-skillset, onboard, list, init)
    |
    +-- AgentRegistry.getInstance().get({ name: agentName }) --> AgentConfig
    +-- AgentRegistry.getInstance().getAll() --> iterate all AgentConfigs
    |
    +-- Shared handler functions (agentHandlers.ts)
    |       |
    |       +-- getAgentDir({ agentConfig, installDir }) --> agent's config directory path
    |       +-- getSkillsDir({ agentConfig, installDir }) --> agent's skills directory path
    |       +-- getManagedFiles({ agentConfig }) --> root-level filenames this agent manages
    |       +-- getManagedDirs({ agentConfig }) --> directory names this agent manages recursively
    |       +-- switchSkillset({ agentConfig, installDir, skillsetName }) --> Validate and switch
    |       +-- detectLocalChanges({ agentConfig, installDir }) --> Compare against stored manifest
    |       +-- removeSkillset({ agentConfig, installDir }) --> Remove all Nori-managed files
    |       +-- installSkillset({ agentConfig, config, skipManifest? }) --> Run loaders, write manifest, mark install
    |       +-- isInstalledAtDir({ agentConfig, path }) --> Check for agent installation marker
    |       +-- markInstall({ agentConfig, path, skillsetName }) --> Write agent installation marker
    |       +-- detectExistingConfig({ agentConfig, installDir }) --> Detect unmanaged config
    |       +-- captureExistingConfig({ agentConfig, installDir, skillsetName, config }) --> Capture and clean up
    |
    +-- AgentConfig data fields (per agent)
    |       +-- name, displayName, description
    |       +-- agentDirName, instructionFilePath, configFileName
    |       +-- skillsPath, slashcommandsPath, subagentsPath
    |       +-- extraLoaders, extraManagedFiles, extraManagedDirs
    |       +-- transcriptDirectory (optional, used by watch command)
    |       +-- factoryReset (optional function field)
    |       +-- findArtifacts (optional function field)
    |       +-- legacyMarkerDetection (optional function field)
    |       +-- configurePermissions (optional function field)
    |
    +-- listProfiles() --> Available skillset names (from managedFolder.ts)

Shared Resources (@/src/cli/features/)
    |
    +-- agentRegistry.ts: AgentName, AgentConfig, Loader, ExistingConfig types
    +-- shared/agentHandlers.ts: All behavioral operations as standalone functions
    +-- shared/profileLoaders/: Profile installation sub-loaders (skills, instructionsMd, slashCommands, subagents)
    +-- paths.ts: getNoriDir(), getNoriSkillsetsDir() (agent-agnostic Nori paths)
    +-- template.ts: substituteTemplatePaths() (agent-agnostic placeholder substitution)
    +-- skillsetMetadata.ts: readSkillsetMetadata(), writeSkillsetMetadata(), addSkillToNoriJson(), ensureNoriJson()
    +-- skillset.ts: Skillset type, parseSkillset() (agent-agnostic skillset directory parser)
    +-- managedFolder.ts: listProfiles(), MANIFEST_FILE (agent-agnostic)
    +-- config/loader.ts: configLoader (shared across all agents)
    +-- bundled-skillsets/: Bundled skills installer shared across all agents (copyBundledSkills, getBundledSkillsDir)
    +-- test-utils/: Shared test utilities (stripAnsi, pathExists, createTempTestContext)
```

The `--agent` global CLI option (default: "claude-code") determines which agent configuration is used. The active skillset is stored as `activeSkillset` in the Config type, shared across all agents.

The init command (@/src/cli/commands/init/) uses `getDefaultAgents()` from @/src/cli/config.js to resolve the default agents at the start, then passes the `AgentConfig` to shared handler functions (`isInstalledAtDir`, `detectExistingConfig`, `captureExistingConfig`, `markInstall`) for all agent-specific operations.

### Core Implementation

`agentRegistry.ts` defines the `AgentConfig` type (pure data struct with declarative fields) and the `AgentRegistry` singleton that maps agent names to configurations. Registered agents are `claude-code` and `cursor-agent`. All behavioral operations (install, remove, detect, capture, switch) live in shared handler functions at `@/src/cli/features/shared/agentHandlers.ts` that accept `AgentConfig` as a parameter. `managedFolder.ts` provides `listSkillsets()` which discovers both flat skillsets (e.g., `"senior-swe"`) and namespaced skillsets (e.g., `"myorg/my-skillset"`) by walking the profiles directory and checking for `nori.json` manifests. The `Loader` type defined here is the contract that all feature loaders must satisfy: a `name`, `description`, and async `run` function.

**Shared Types** (agentRegistry.ts):

| Type | Purpose |
|------|---------|
| `AgentName` | Union type of canonical agent identifiers (`"claude-code" | "cursor-agent"`). Used as the registry key and source of truth for agent identity. |
| `AgentConfig` | Pure data struct describing an agent's filesystem layout and optional features. Contains declarative fields (paths, names, descriptions) and optional function fields for agent-specific behavior (legacyMarkerDetection, configurePermissions, findArtifacts, factoryReset). All generic operations live in shared handler functions. |
| `Loader` | Interface for feature installation with `name`, `description`, and `run()` method. `run()` returns `Promise<string | void>` -- returning a string label (e.g., "Hooks", "Status line") signals inclusion in the consolidated Settings output note |
| `ExistingConfig` | Object describing detected unmanaged configuration (configFileName, hasConfigFile, hasManagedBlock, hasSkills, skillCount, hasAgents, agentCount, hasCommands, commandCount). The `configFileName` field carries the agent's config file name (e.g., "CLAUDE.md") so the init flow can display agent-appropriate strings without hardcoding. Returned by `detectExistingConfig` handler and used by init command to show users what was found. |
| `AgentArtifact` | Describes a discovered configuration artifact (path + type). Used by `findArtifacts` and factory reset to show what will be deleted. |

**AgentConfig fields** (agentRegistry.ts):
- `name`: `AgentName` - canonical identifier used as the registry key ("claude-code")
- `displayName`: Human-readable name ("Claude Code")
- `description`: Short string describing which skillset features the agent supports. Surfaced as a hint in the config multiselect UI.
- `agentDirName`: Relative path from installDir to the agent's config directory (e.g., ".claude")
- `instructionFilePath`: Relative path from the agent dir to the instruction file (e.g., "CLAUDE.md")
- `configFileName`: The config file name used when parsing skillsets from ~/.nori/profiles/
- `skillsPath`, `slashcommandsPath`, `subagentsPath`: Relative paths within the agent dir
- `extraLoaders`: Optional array of agent-specific loaders (hooks, statusline, announcements) run after shared profile loaders
- `extraManagedFiles`: Optional additional root-level filenames beyond the instruction file (e.g., ["settings.json", "nori-statusline.sh"])
- `extraManagedDirs`: Optional additional managed directories beyond skills/commands/agents
- `transcriptDirectory`: Optional absolute path to transcript storage. Used by the watch command. null if agent does not support transcripts.
- `legacyMarkerDetection`: Optional function for backwards-compatible installation detection (e.g., checking CLAUDE.md for managed block)
- `hasLegacyManifest`: Whether this agent has a legacy manifest path to clean up
- `configurePermissions`: Optional function for agent-specific permissions (e.g., Claude Code adds directories to settings.json)
- `findArtifacts`: Optional function to discover agent config artifacts in ancestor directories
- `factoryReset`: Optional function for agent-specific factory reset

**Shared Handler Functions** (shared/agentHandlers.ts):
- `getAgentDir({ agentConfig, installDir })`: Computes `path.join(installDir, agentConfig.agentDirName)`.
- `getSkillsDir({ agentConfig, installDir })`: Computes the full skills directory path from agentConfig fields.
- `getManagedFiles({ agentConfig })`: Returns instruction file basename plus any `extraManagedFiles`.
- `getManagedDirs({ agentConfig })`: Returns skills/commands/agents paths plus any `extraManagedDirs`.
- `isInstalledAtDir({ agentConfig, path })`: Checks for `.nori-managed` marker file, falls back to `legacyMarkerDetection` if available.
- `markInstall({ agentConfig, path, skillsetName })`: Creates agent dir and writes `.nori-managed` marker.
- `detectLocalChanges({ agentConfig, installDir })`: Reads per-agent manifest (with legacy fallback), compares hashes, returns `ManifestDiff` or null.
- `removeSkillset({ agentConfig, installDir })`: Reads manifest and removes managed files. Also cleans up legacy manifest if applicable.
- `installSkillset({ agentConfig, config, skipManifest? })`: Runs config loader, shared profiles loader, agent-specific extra loaders, writes manifest, emits Skills note, and marks install. When `skipManifest` is true, manifest operations are skipped (used for transient `--install-dir` overrides).
- `switchSkillset({ agentConfig, installDir, skillsetName })`: Validates skillset exists and logs success. Does not persist config.
- `detectExistingConfig({ agentConfig, installDir })`: Scans agent directory for unmanaged config. Returns `ExistingConfig` or null.
- `captureExistingConfig({ agentConfig, installDir, skillsetName, config })`: Captures existing config as a skillset, cleans up originals, restores managed instruction file.

**Shared Profile Loaders** (shared/profileLoaders/):
- `profilesLoader.ts`: Orchestrates profile installation for any agent. Creates `~/.nori/profiles/`, calls `agentConfig.configurePermissions` if defined, parses the active skillset via `parseSkillset()`, and runs sub-loaders in order (skills -> instructionsMd -> slashCommands -> subagents). Called by `installSkillset()` in agentHandlers.ts.
- `skillsLoader.ts`: Copies skills from the skillset's `skills/` directory to the agent's skills directory with template substitution, then calls `copyBundledSkills()` from bundled-skillsets to add package-bundled skills.
- `instructionsMdLoader.ts`: Generates the agent's instruction file (CLAUDE.md, AGENTS.md, etc.) with managed block markers. Reads source content from the skillset's config file path, strips existing markers to prevent nesting, and wraps with fresh markers.
- `slashCommandsLoader.ts`: Copies slash command `.md` files to the agent's commands directory. Emits a consolidated "Slash Commands" note listing all installed commands.
- `subagentsLoader.ts`: Copies subagent `.md` files to the agent's agents directory. Emits a consolidated "Subagents" note listing all installed subagents.

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern with `getInstance()`
- `get({ name })`: Look up agent config by name, throws if not found. Returns `AgentConfig`.
- `getAll()`: Returns array of all registered `AgentConfig` objects.
- `list()`: Returns array of registered agent names
- `getDefaultAgentName()`: Returns the name of the first registered agent. Used as the canonical fallback when no agent is explicitly specified.
- `resetInstance()`: For test isolation
- `getAgentDirNames()`: Returns the config directory basenames (e.g., `[".claude", ".cursor"]`) for all registered agents. Used by `normalizeInstallDir()` and `resolveInstallDir()` in @/src/utils/path.ts to strip agent-specific directory suffixes from install paths without hardcoding agent directory names.

**Config Loader** (config/loader.ts):
- Shared loader that manages the `.nori-config.json` file lifecycle (single source of truth for config and version)
- All agents include this loader via the shared `installSkillset` handler
- Handles saving/removing config with auth credentials, skillset selection, user preferences, and version tracking
- During install: Calls `updateConfig()` from @/src/cli/config.ts to persist `activeSkillset`, version, auth credentials, and transcript settings. Because `updateConfig()` uses a read-merge-write pattern, fields like `installDir`, `defaultAgents`, `autoupdate`, and `redownloadOnSwitch` are automatically preserved from the existing config without explicit pass-through. The config loader does not write `installDir` -- only `sks config` persists that field
- Uses `@clack/prompts` (`log.*`, `note()`) for user-facing output. Auth error details are consolidated into a `note()` section rather than individual log lines.

**Bundled Skills Installer** (bundled-skillsets/installer.ts):
- Agent-agnostic module that copies bundled skills to any agent's skills directory during installation. Exports `copyBundledSkills({ destSkillsDir, installDir })` (called by the shared skills loader after copying skillset skills) and `getBundledSkillsDir()` (called by the shared instruction file loader to include bundled skills in the skills list). Skillset-provided skills take precedence -- bundled skills with a conflicting name are skipped. See @/src/cli/features/bundled-skillsets/docs.md for details.

**Managed Folder Utilities** (managedFolder.ts):
- Agent-agnostic skillset discovery
- `listProfiles()`: Zero-arg function that scans `~/.nori/profiles/` for directories containing `nori.json`, supporting both flat profiles (e.g., `senior-swe`) and namespaced profiles (e.g., `myorg/my-profile`). Uses `getNoriSkillsetsDir()` from @/src/cli/features/paths.ts internally. Returns a sorted array of skillset names. Before checking each directory for `nori.json`, calls `ensureNoriJson()` from @/src/cli/features/skillsetMetadata.ts to auto-create the manifest for user-created skillsets that lack one (applies to both flat and nested org skillset directories).
- `MANIFEST_FILE`: Constant (`"nori.json"`) used by both this module and the shared `switchSkillset` handler to identify valid skillsets
- Imported directly by CLI commands (`list`, `switch-skillset`) rather than going through the registry

**Shared Paths** (paths.ts):
- `getNoriDir()`: Returns `~/.nori` -- the centralized Nori data directory. Used by manifest storage, migration, and other shared infrastructure.
- `getNoriSkillsetsDir()`: Returns `~/.nori/profiles/` -- where all skillset templates are stored. Previously lived in @/src/cli/features/claude-code/paths.ts but was extracted because it is an agent-agnostic Nori concept. Imported by CLI commands, managedFolder.ts, skillset loaders, and agent implementations.

**Shared Template Substitution** (template.ts):
- `substituteTemplatePaths({ content, installDir })`: Replaces `{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}` placeholders in skillset content with actual filesystem paths. Supports backtick-escaped placeholders (e.g., `` `{{skills_dir}}` ``) that are preserved as literal text. The `installDir` parameter is the agent config directory (e.g., `~/.claude`), not the parent. Previously lived in @/src/cli/features/claude-code/template.ts but was extracted because template substitution is agent-agnostic.

**Shared Skillset Metadata** (skillsetMetadata.ts):
- `readSkillsetMetadata({ skillsetDir })`: Reads and parses `nori.json` from a skillset directory.
- `writeSkillsetMetadata({ skillsetDir, metadata })`: Writes a `NoriJson` object to `nori.json`.
- `addSkillToNoriJson({ skillsetDir, skillName, version })`: Adds or updates a skill dependency in `dependencies.skills`. Creates a basic `nori.json` if one does not exist.
- `ensureNoriJson({ skillsetDir })`: Backwards-compatibility shim that auto-creates `nori.json` for directories that look like skillsets (have `CLAUDE.md` or both `skills/` and `subagents/` subdirectories) but lack a manifest. Called at every entry point that validates skillset existence.
- Previously lived in @/src/cli/features/claude-code/skillsets/metadata.ts but was extracted because skillset metadata operations are agent-agnostic.

**Skillset Parser** (skillset.ts):
- Defines the `Skillset` type: a content-agnostic representation of a skillset's filesystem structure with fields for `name`, `dir`, `metadata` (NoriJson), `skillsDir`, `configFilePath`, `slashcommandsDir`, and `subagentsDir` (all path fields nullable for optional components).
- `parseSkillset({ skillsetName?, skillsetDir?, configFileName? })`: Resolves a skillset directory (by name from `~/.nori/profiles/` or by explicit path), calls `ensureNoriJson()` for backwards compatibility, reads metadata, and probes for optional subdirectories/files. The `configFileName` parameter (defaults to `"CLAUDE.md"`) controls which root config file is looked for in the skillset directory, enabling agent-agnostic resolution when each agent passes its `configFileName` from `AgentConfig`. Returns a `Skillset` object. Called by the shared `installProfiles` loader to parse the active skillset once, then distribute to all sub-loaders.
- The shared profile loaders in `shared/profileLoaders/` accept `{ agentConfig, config, skillset }` so sub-loaders receive the pre-parsed `Skillset` and the `AgentConfig` for path resolution.

**Migration System** (migration.ts):
- Versioned migration system for transforming config between formats during installation
- The `migrate()` function applies all migrations newer than `previousVersion` in semver order
- Current migrations:
  - **v19.0.0 (consolidate-auth-and-profile-structure)**: Flat auth fields to nested `auth: {...}` structure; legacy profile field migration
  - **v20.0.0 (move-profiles-to-nori-directory)**: Removes the old `~/.claude/profiles/` directory to clean up after migration to `~/.nori/profiles/`

### Things to Know

The `AgentRegistry` registers `claude-code` and `cursor-agent` in its constructor. The `AgentConfig` type is a pure data struct -- all behavioral operations live in shared handler functions at `@/src/cli/features/shared/agentHandlers.ts`. Agent-specific behavior is handled through optional function fields on `AgentConfig` (e.g., `legacyMarkerDetection`, `configurePermissions`, `factoryReset`, `findArtifacts`) that the shared handlers invoke when present. `listSkillsets` calls `ensureNoriJson` as a backwards-compatibility shim, auto-generating `nori.json` for legacy skillsets that lack one.

Created and maintained by Nori.
