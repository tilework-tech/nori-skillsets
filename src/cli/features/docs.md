# Noridoc: features

Path: @/src/cli/features

### Overview

Agent abstraction layer that defines the Agent interface and registry for the Claude Code agent. Contains shared types (`Loader`, `LoaderRegistry`, `ExistingConfig`) that agents implement, plus the shared config loader. Also contains agent-agnostic utilities like skillset discovery (`managedFolder.ts`) and shared test utilities (@/src/cli/features/test-utils/) used across agent and command tests.

### How it fits into the larger codebase

The features directory sits between the CLI commands (@/src/cli/commands/) and the Claude Code agent implementation (@/src/cli/features/claude-code/). CLI commands use the AgentRegistry to look up the agent implementation by name, then delegate to the agent's loaders and skillset methods.

```
CLI Commands (install, switch-skillset, onboard, list, init)
    |
    +-- AgentRegistry.getInstance().get({ name: agentName })
    +-- AgentRegistry.getInstance().getAll()  --> iterate all agents
    |       |
    |       +-- Agent interface
    |           |
    |           +-- getLoaderRegistry() --> LoaderRegistry (interface)
    |           +-- switchSkillset({ installDir, skillsetName }) --> Validate and switch
    |           +-- factoryReset({ path }) --> Remove all agent config (optional)
    |           +-- isInstalledAtDir({ path }) --> Check for agent installation marker
    |           +-- markInstall({ path, skillsetName }) --> Write agent installation marker
    |           +-- detectExistingConfig({ installDir }) --> Detect unmanaged config (optional)
    |           +-- captureExistingConfig({ installDir, skillsetName, config }) --> Capture and clean up (optional)
    |
    +-- listProfiles() --> Available skillset names (from managedFolder.ts)

Shared Resources (@/src/cli/features/)
    |
    +-- agentRegistry.ts: AgentName, Agent, Loader, LoaderRegistry, ExistingConfig types
    +-- managedFolder.ts: listProfiles(), MANIFEST_FILE (agent-agnostic)
    +-- config/loader.ts: configLoader (shared across all agents)
    +-- test-utils/: Shared test utilities (stripAnsi, pathExists, createTempTestContext)
```

The `--agent` global CLI option (default: "claude-code") determines which agent implementation is used. The active skillset is stored as `activeSkillset` in the Config type, shared across all agents.

The init command (@/src/cli/commands/init/) uses `getDefaultAgent()` from @/src/cli/config.js to resolve the default agent at the start, then delegates all agent-specific operations (detection, capture, installation marking) through that agent's interface methods.

### Core Implementation

**Shared Types** (agentRegistry.ts):

| Type | Purpose |
|------|---------|
| `AgentName` | Type alias for the canonical agent identifier `"claude-code"`. Used as the registry key and source of truth for agent identity. |
| `Loader` | Interface for feature installation with `name`, `description`, and `run()` methods |
| `LoaderRegistry` | Interface that agent-specific registry classes must implement (`getAll()`) |
| `ExistingConfig` | Object describing detected unmanaged configuration (hasClaudeMd, hasManagedBlock, hasSkills, skillCount, hasAgents, agentCount, hasCommands, commandCount). Returned by `detectExistingConfig` and used by init command to show users what was found. Canonical definition in agentRegistry.ts, re-exported from @/src/cli/commands/install/existingConfigCapture.ts for backward compatibility. |

**Agent Interface** (agentRegistry.ts):
- `name`: `AgentName` - canonical identifier used as the registry key ("claude-code")
- `displayName`: Human-readable name ("Claude Code")
- `getLoaderRegistry()`: Returns an object implementing the `LoaderRegistry` interface
- `switchSkillset({ installDir, skillsetName })`: Validates skillset exists and updates the `activeSkillset` in config
- `factoryReset({ path })`: Optional. Removes all agent configuration from the filesystem starting at the given path. The CLI command layer handles non-interactive blocking and confirmation; the agent method handles discovery and deletion.
- `isInstalledAtDir({ path })`: Returns boolean indicating whether this agent is installed at the given directory. Each agent defines its own detection strategy (e.g., marker files, config content checks).
- `markInstall({ path, skillsetName })`: Writes an installation marker at the given directory. The optional `skillsetName` parameter records the active skillset in the marker. Called by init and install commands after feature loaders complete.
- `detectExistingConfig({ installDir })`: Optional. Detects unmanaged existing configuration at the given install directory. Returns an `ExistingConfig` object describing what was found (CLAUDE.md presence, managed block detection, skill/agent/command counts) or null if no configuration exists. Used by init command to determine if existing config should be captured before Nori installation.
- `captureExistingConfig({ installDir, skillsetName, config })`: Optional. Captures existing unmanaged configuration as a named skillset, cleans up original files to prevent duplication, and restores a working managed configuration. Takes the `config` parameter to know which skillset to activate. Used by init command when existing config is detected and user opts to preserve it.

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern with `getInstance()`
- `get({ name })`: Look up agent by name, throws if not found
- `getAll()`: Returns array of all registered Agent objects. Used by code that needs to iterate all agents rather than look up by name (e.g., installation detection in @/src/utils/path.ts)
- `list()`: Returns array of registered agent names
- `resetInstance()`: For test isolation

**Config Loader** (config/loader.ts):
- Shared loader that manages the `.nori-config.json` file lifecycle (single source of truth for config and version)
- All agents MUST include this loader in their registry
- Handles saving/removing config with auth credentials, skillset selection, user preferences, and version tracking
- During install: Saves the `activeSkillset` and current package version in the `version` field. Preserves existing `activeSkillset` (ensures skillset set by `switchSkillset` survives reinstallation). Also preserves `organizations`, `isAdmin`, `transcriptDestination`, `installDir`, and `defaultAgents` from the existing config. The `installDir` and `defaultAgents` fields use the `existingConfig?.field ?? config.field` pattern so they are only changed via `nori-skillsets config` or on initial setup

**Managed Folder Utilities** (managedFolder.ts):
- Agent-agnostic skillset discovery extracted from the Agent interface
- `listProfiles()`: Zero-arg function that scans `~/.nori/profiles/` for directories containing `nori.json`, supporting both flat profiles (e.g., `senior-swe`) and namespaced profiles (e.g., `myorg/my-profile`). Uses `getNoriProfilesDir()` internally. Returns a sorted array of skillset names. Before checking each directory for `nori.json`, calls `ensureNoriJson()` from @/src/cli/features/claude-code/skillsets/metadata.ts to auto-create the manifest for user-created skillsets that lack one (applies to both flat and nested org skillset directories).
- `MANIFEST_FILE`: Constant (`"nori.json"`) used by both this module and `claudeCodeAgent.switchSkillset()` to identify valid skillsets
- Imported directly by CLI commands (`list`, `switch-skillset`) rather than going through the Agent interface

**Migration System** (migration.ts):
- Versioned migration system for transforming config between formats during installation
- The `migrate()` function applies all migrations newer than `previousVersion` in semver order
- Current migrations:
  - **v19.0.0 (consolidate-auth-and-profile-structure)**: Flat auth fields to nested `auth: {...}` structure; legacy profile field migration
  - **v20.0.0 (move-profiles-to-nori-directory)**: Removes the old `~/.claude/profiles/` directory to clean up after migration to `~/.nori/profiles/`

### Things to Know

**`AgentName` is the canonical UID for agents.** The `AgentName` type (`"claude-code"`) is the source of truth for valid agent identifiers. CLI entry points parse the `--agent` option string, look up the `Agent` object once via `AgentRegistry.get({ name })`, then pass the `Agent` object around. Functions that need the agent identifier access `agent.name` rather than receiving a separate string parameter.

**Loader descriptions must be noun phrases.** Loader `description` fields are displayed in install contexts. Descriptions should be noun phrases (e.g., "Skillset templates in ~/.nori/profiles/") not action verbs (e.g., "Install Nori profile templates...").

**Critical: All agents must include the config loader.** The `configLoader` from @/src/cli/features/config/loader.ts manages the shared `.nori-config.json` file. Each agent's LoaderRegistry class must register this loader to ensure proper config file creation during install.

The AgentRegistry auto-registers claude-code in its constructor.

Profile discovery is handled by the standalone `listProfiles()` function (zero-arg) in @/src/cli/features/managedFolder.ts, not by the Agent interface. This function uses `getNoriProfilesDir()` to scan `~/.nori/profiles/` for valid profiles (directories containing `nori.json`). Before checking each directory, it calls `ensureNoriJson()` to auto-create `nori.json` for user-created skillsets that look like profiles but lack the manifest. Skillset switching remains on the Agent interface via `switchSkillset()`. Since no built-in skillsets are shipped with the package, skillsets are obtained exclusively from the registry or created by users.

Agent implementations manage their own internal paths (config directories, instruction file names, etc.) without exposing them through the public interface. Claude Code's path helpers live in @/src/cli/features/claude-code/paths.ts. The env.ts file re-exports these functions for backward compatibility.

Template substitution utilities are agent-specific. Claude Code (@/src/cli/features/claude-code/template.ts) uses `{{skills_dir}}` and supports common placeholders: `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}`.

**Init delegates all agent-specific operations through the default agent.** The init command resolves the default agent from `config.defaultAgents` at the start using `getDefaultAgent()` and `AgentRegistry.get()`, then uses only that agent's interface methods (`isInstalledAtDir`, `detectExistingConfig`, `captureExistingConfig`, `markInstall`) for all operations. This ensures init remains agent-agnostic while allowing each agent to define its own detection and capture logic.

Created and maintained by Nori.
