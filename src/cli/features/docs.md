# Noridoc: features

Path: @/src/cli/features

### Overview

The features directory contains the agent abstraction layer and all agent-specific feature implementations. It defines the `Agent` and `Loader` interfaces that allow the system to support multiple AI coding agents, and houses agent implementations (Claude Code and Cursor) along with shared test utilities.

### How it fits into the larger codebase

The `AgentRegistry` singleton is the central entry point used by CLI commands (e.g., `@/src/cli/commands/init`) to discover and interact with agent implementations. Each agent provides a `LoaderRegistry` that returns ordered `Loader` instances, which the init flow executes sequentially to install configuration. The `managedFolder.ts` module provides agent-agnostic skillset discovery by scanning `~/.nori/profiles/` for directories containing `nori.json` manifests, and is used by commands that need to list available skillsets.

The features directory sits between the CLI commands (@/src/cli/commands/) and agent implementations (@/src/cli/features/claude-code/, @/src/cli/features/cursor-agent/). CLI commands use the AgentRegistry to look up the agent implementation by name, then delegate to the agent's loaders and skillset methods.

```
CLI Commands (install, switch-skillset, onboard, list, init)
    |
    +-- AgentRegistry.getInstance().get({ name: agentName })
    +-- AgentRegistry.getInstance().getAll()  --> iterate all agents
    |       |
    |       +-- Agent interface
    |           |
    |           +-- getAgentDir({ installDir }) --> agent's config directory path
    |           +-- getSkillsDir({ installDir }) --> agent's skills directory path
    |           +-- getManagedFiles() --> root-level filenames this agent manages
    |           +-- getManagedDirs() --> directory names this agent manages recursively
    |           +-- getLoaderRegistry() --> LoaderRegistry (interface)
    |           +-- switchSkillset({ installDir, skillsetName }) --> Validate and switch
    |           +-- detectLocalChanges({ installDir }) --> Compare current files against stored manifest
    |           +-- removeSkillset({ installDir }) --> Remove all Nori-managed files for this agent
    |           +-- installSkillset({ config, skipManifest? }) --> Run loaders, optionally write manifest, mark install
    |           +-- factoryReset({ path }) --> Remove all agent config (optional)
    |           +-- isInstalledAtDir({ path }) --> Check for agent installation marker
    |           +-- markInstall({ path, skillsetName }) --> Write agent installation marker
    |           +-- detectExistingConfig({ installDir }) --> Detect unmanaged config (optional)
    |           +-- captureExistingConfig({ installDir, skillsetName, config }) --> Capture and clean up (optional)
    |           +-- getTranscriptDirectory() --> agent's transcript file directory (optional)
    |           +-- findArtifacts({ startDir }) --> discover agent config artifacts (optional)
    |
    +-- listProfiles() --> Available skillset names (from managedFolder.ts)

Shared Resources (@/src/cli/features/)
    |
    +-- agentRegistry.ts: AgentName, Agent, Loader, LoaderRegistry, ExistingConfig types
    +-- paths.ts: getNoriDir(), getNoriSkillsetsDir() (agent-agnostic Nori paths)
    +-- template.ts: substituteTemplatePaths() (agent-agnostic placeholder substitution)
    +-- skillsetMetadata.ts: readSkillsetMetadata(), writeSkillsetMetadata(), addSkillToNoriJson(), ensureNoriJson()
    +-- skillset.ts: Skillset type, parseSkillset() (agent-agnostic skillset directory parser)
    +-- managedFolder.ts: listProfiles(), MANIFEST_FILE (agent-agnostic)
    +-- config/loader.ts: configLoader (shared across all agents)
    +-- bundled-skillsets/: Bundled skills installer shared across all agents (copyBundledSkills, getBundledSkillsDir)
    +-- test-utils/: Shared test utilities (stripAnsi, pathExists, createTempTestContext)
```

The `--agent` global CLI option (default: "claude-code") determines which agent implementation is used. The active skillset is stored as `activeSkillset` in the Config type, shared across all agents.

The init command (@/src/cli/commands/init/) uses `getDefaultAgent()` from @/src/cli/config.js to resolve the default agent at the start, then delegates all agent-specific operations (detection, capture, installation marking) through that agent's interface methods.

### Core Implementation

`agentRegistry.ts` defines the `Agent` interface (install detection, skillset switching, factory reset, existing config capture) and the `AgentRegistry` singleton that maps agent names to implementations. Registered agents are `claude-code` and `cursor-agent`. `managedFolder.ts` provides `listSkillsets()` which discovers both flat skillsets (e.g., `"senior-swe"`) and namespaced skillsets (e.g., `"myorg/my-skillset"`) by walking the profiles directory and checking for `nori.json` manifests. The `Loader` type defined here is the contract that all feature loaders must satisfy: a `name`, `description`, and async `run` function.

**Shared Types** (agentRegistry.ts):

| Type | Purpose |
|------|---------|
| `AgentName` | Union type of canonical agent identifiers (`"claude-code" | "cursor-agent"`). Used as the registry key and source of truth for agent identity. |
| `Loader` | Interface for feature installation with `name`, `description`, and `run()` method. `run()` returns `Promise<string | void>` -- returning a string label (e.g., "Hooks", "Status line") signals inclusion in the consolidated Settings output note |
| `LoaderRegistry` | Interface that agent-specific registry classes must implement (`getAll()`) |
| `ExistingConfig` | Object describing detected unmanaged configuration (configFileName, hasConfigFile, hasManagedBlock, hasSkills, skillCount, hasAgents, agentCount, hasCommands, commandCount). The `configFileName` field carries the agent's config file name (e.g., "CLAUDE.md") so the init flow can display agent-appropriate strings without hardcoding. Returned by `detectExistingConfig` and used by init command to show users what was found. Canonical definition in agentRegistry.ts, re-exported from @/src/cli/commands/install/existingConfigCapture.ts for backward compatibility. |
| `AgentArtifact` | Describes a discovered configuration artifact (path + type). Used by `findArtifacts` and factory reset to show what will be deleted. |

**Agent Interface** (agentRegistry.ts):
- `name`: `AgentName` - canonical identifier used as the registry key ("claude-code")
- `displayName`: Human-readable name ("Claude Code")
- `description`: Short string describing which skillset features the agent supports (e.g., "Instructions, skills, subagents, commands, hooks, statusline" for Claude Code). Surfaced as a hint in the config multiselect UI at @/src/cli/prompts/flows/config.ts.
- `getAgentDir({ installDir })`: Returns the absolute path to this agent's config directory under the given install directory. Each agent declares its own directory (e.g., claude-code returns `{installDir}/.claude/`). Used by shared modules that need to locate agent-specific paths without importing agent internals.
- `getSkillsDir({ installDir })`: Returns the absolute path to this agent's skills directory under the given install directory (e.g., claude-code returns `{installDir}/.claude/skills/`).
- `getManagedFiles()`: Returns the list of root-level filenames within the agent's config directory that this agent manages. Used by the manifest module for installation tracking and change detection.
- `getManagedDirs()`: Returns the list of directory names within the agent's config directory that this agent manages recursively. Used by the manifest module and cleanup operations.
- `getLoaderRegistry()`: Returns an object implementing the `LoaderRegistry` interface
- `switchSkillset({ installDir, skillsetName })`: Validates skillset exists and logs success. Does not persist config -- config persistence (`updateConfig({ activeSkillset })`) is the command layer's responsibility, gated on install-dir provenance
- `detectLocalChanges({ installDir })`: Reads the per-agent manifest (with legacy fallback), compares current agent directory file hashes against stored hashes using `getManagedFiles()` and `getManagedDirs()`, and returns a `ManifestDiff` if changes exist or null otherwise. Used by the switch-skillset command to warn about unsaved local modifications before switching.
- `removeSkillset({ installDir })`: Removes all Nori-managed files from the agent's config directory at the given `installDir` by reading the per-agent manifest and delegating to `removeManagedFiles()` from @/src/cli/features/manifest.ts. Also cleans up the legacy manifest path. Used by the config command when the user changes `installDir` and opts to clean up the old directory.
- `installSkillset({ config, skipManifest? })`: Runs all feature loaders from the agent's `LoaderRegistry` in order, collects string labels returned by loaders to emit a consolidated "Settings" `note()` via `@clack/prompts`. When `skipManifest` is not true, computes and writes an installation manifest (per-agent at `~/.nori/manifests/<agentName>.json`) for subsequent change detection. When `skipManifest` is true, manifest computation and writing are skipped entirely -- this is set by the command layer when the install directory's provenance is `"cli"` (i.e., from a transient `--install-dir` flag, as tracked by `ResolvedInstallDir` from @/src/utils/path.ts), because the manifest is stored globally per-agent and would produce false positives when compared against a different directory on the next invocation. Emits a "Skills" `note()` listing installed skill names from the parsed skillset's `skillsDir`, and calls `markInstall()` to write the `.nori-managed` marker. Manifest writing and skill listing are non-fatal. Used by the install command (`completeInstallation` in @/src/cli/commands/install/install.ts), which delegates the entire installation flow to this single method.
- `factoryReset({ path })`: Optional. Removes all agent configuration from the filesystem starting at the given path. The CLI command layer handles non-interactive blocking and confirmation; the agent method handles discovery and deletion.
- `isInstalledAtDir({ path })`: Returns boolean indicating whether this agent is installed at the given directory. Each agent defines its own detection strategy (e.g., marker files, config content checks).
- `markInstall({ path, skillsetName })`: Writes an installation marker at the given directory. The optional `skillsetName` parameter records the active skillset in the marker. Called by init and install commands after feature loaders complete.
- `detectExistingConfig({ installDir })`: Optional. Detects unmanaged existing configuration at the given install directory. Returns an `ExistingConfig` object describing what was found (CLAUDE.md presence, managed block detection, skill/agent/command counts) or null if no configuration exists. Used by init command to determine if existing config should be captured before Nori installation.
- `captureExistingConfig({ installDir, skillsetName, config })`: Optional. Captures existing unmanaged configuration as a named skillset, cleans up original files to prevent duplication, and restores a working managed configuration. Takes the `config` parameter to know which skillset to activate. Used by init command when existing config is detected and user opts to preserve it.
- `getTranscriptDirectory()`: Optional. Returns the directory where this agent stores session transcript files (e.g., JSONL files). Claude-code returns `~/.claude/projects`. Agents that store transcripts in non-file-based formats (like SQLite) should not implement this. Used by the watch command to locate transcript source files.
- `findArtifacts({ startDir, stopDir? })`: Optional. Discovers agent configuration artifacts (directories and files) starting from `startDir` and walking up the ancestor tree. Returns an array of `AgentArtifact` objects. Used by factory reset to show what will be deleted before confirmation.

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern with `getInstance()`
- `get({ name })`: Look up agent by name, throws if not found
- `getAll()`: Returns array of all registered Agent objects. Used by code that needs to iterate all agents rather than look up by name (e.g., installation detection in @/src/utils/path.ts)
- `list()`: Returns array of registered agent names
- `getDefaultAgentName()`: Returns the name of the first registered agent. Used as the canonical fallback when code needs a default agent name without hardcoding "claude-code"
- `resetInstance()`: For test isolation
- `getAgentDirNames()`: Returns the config directory basenames (e.g., `[".claude", ".cursor"]`) for all registered agents. Used by `normalizeInstallDir()` and `resolveInstallDir()` in @/src/utils/path.ts to strip agent-specific directory suffixes from install paths without hardcoding agent directory names.

**Config Loader** (config/loader.ts):
- Shared loader that manages the `.nori-config.json` file lifecycle (single source of truth for config and version)
- All agents MUST include this loader in their registry
- Handles saving/removing config with auth credentials, skillset selection, user preferences, and version tracking
- During install: Calls `updateConfig()` from @/src/cli/config.ts to persist `activeSkillset`, version, auth credentials, and transcript settings. Because `updateConfig()` uses a read-merge-write pattern, fields like `installDir`, `defaultAgents`, `autoupdate`, and `redownloadOnSwitch` are automatically preserved from the existing config without explicit pass-through. The config loader does not write `installDir` -- only `sks config` persists that field
- Uses `@clack/prompts` (`log.*`, `note()`) for user-facing output. Auth error details are consolidated into a `note()` section rather than individual log lines.

**Bundled Skills Installer** (bundled-skillsets/installer.ts):
- Agent-agnostic module that copies bundled skills to any agent's skills directory during installation. Exports `copyBundledSkills({ destSkillsDir, installDir })` (called by both agent skill loaders after copying skillset skills) and `getBundledSkillsDir()` (called by the CLAUDE.md generator to include bundled skills in the skills list). Skillset-provided skills take precedence -- bundled skills with a conflicting name are skipped. See @/src/cli/features/bundled-skillsets/docs.md for details.

**Managed Folder Utilities** (managedFolder.ts):
- Agent-agnostic skillset discovery extracted from the Agent interface
- `listProfiles()`: Zero-arg function that scans `~/.nori/profiles/` for directories containing `nori.json`, supporting both flat profiles (e.g., `senior-swe`) and namespaced profiles (e.g., `myorg/my-profile`). Uses `getNoriSkillsetsDir()` from @/src/cli/features/paths.ts internally. Returns a sorted array of skillset names. Before checking each directory for `nori.json`, calls `ensureNoriJson()` from @/src/cli/features/skillsetMetadata.ts to auto-create the manifest for user-created skillsets that lack one (applies to both flat and nested org skillset directories).
- `MANIFEST_FILE`: Constant (`"nori.json"`) used by both this module and `claudeCodeAgent.switchSkillset()` to identify valid skillsets
- Imported directly by CLI commands (`list`, `switch-skillset`) rather than going through the Agent interface

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
- `parseSkillset({ skillsetName?, skillsetDir?, configFileName? })`: Resolves a skillset directory (by name from `~/.nori/profiles/` or by explicit path), calls `ensureNoriJson()` for backwards compatibility, reads metadata, and probes for optional subdirectories/files. The `configFileName` parameter (defaults to `"CLAUDE.md"`) controls which root config file is looked for in the skillset directory, enabling agent-agnostic resolution when each agent passes its local `CONFIG_FILE_NAME` constant. Returns a `Skillset` object. Called by the `profilesLoader` to parse the active skillset once, then distribute to all sub-loaders.
- The `ProfileLoader` interface in @/src/cli/features/claude-code/skillsets/skillsetLoaderRegistry.ts accepts `{ config, skillset }` so sub-loaders receive the pre-parsed `Skillset` instead of constructing paths independently.

**Migration System** (migration.ts):
- Versioned migration system for transforming config between formats during installation
- The `migrate()` function applies all migrations newer than `previousVersion` in semver order
- Current migrations:
  - **v19.0.0 (consolidate-auth-and-profile-structure)**: Flat auth fields to nested `auth: {...}` structure; legacy profile field migration
  - **v20.0.0 (move-profiles-to-nori-directory)**: Removes the old `~/.claude/profiles/` directory to clean up after migration to `~/.nori/profiles/`

### Things to Know

The `AgentRegistry` registers `claude-code` and `cursor-agent` in its constructor. The `Agent` interface includes required lifecycle methods (`installSkillset`, `detectLocalChanges`, `removeSkillset`, `switchSkillset`) that all agents must implement for skillset management, and optional methods (`factoryReset`, `detectExistingConfig`, `captureExistingConfig`, `getTranscriptDirectory`, `findArtifacts`) that not all agents need to implement. `listSkillsets` calls `ensureNoriJson` as a backwards-compatibility shim, auto-generating `nori.json` for legacy skillsets that lack one.

Created and maintained by Nori.
