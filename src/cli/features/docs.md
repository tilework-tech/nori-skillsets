# Noridoc: features

Path: @/src/cli/features

### Overview

Multi-agent abstraction layer that defines the Agent interface and registry for supporting multiple AI agents through a unified CLI interface. Currently supports Claude Code and Cursor. Contains shared types (`Loader`, `ValidationResult`, `LoaderRegistry`) that all agents implement, plus the shared config loader that all agents must include. Also contains shared test utilities (@/src/cli/features/test-utils/) used across agent and command tests.

### How it fits into the larger codebase

The features directory sits between the CLI commands (@/src/cli/commands/) and agent-specific implementations (e.g., @/src/cli/features/claude-code/). CLI commands use the AgentRegistry to look up agent implementations by name, then delegate to the agent's loaders and profile methods.

```
CLI Commands (install, uninstall, check, switch-profile)
    |
    +-- AgentRegistry.getInstance().get({ name: agentName })
    |
    +-- Agent interface
        |
        +-- getLoaderRegistry() --> LoaderRegistry (interface)
        +-- listProfiles({ installDir }) --> Available profile names
        +-- switchProfile({ installDir, profileName }) --> Validate and switch

Shared Resources (@/src/cli/features/)
    |
    +-- agentRegistry.ts: AgentName, Agent, Loader, ValidationResult, LoaderRegistry types
    +-- config/loader.ts: configLoader (shared across all agents)
    +-- test-utils/: Shared test utilities (stripAnsi, pathExists, createTempTestContext)
```

The `--agent` global CLI option (default: "claude-code") determines which agent implementation is used. Per-agent profile configuration is stored in the Config `agents` field.

### Core Implementation

**Shared Types** (agentRegistry.ts):

| Type | Purpose |
|------|---------|
| `AgentName` | Type alias for canonical agent identifiers (`"claude-code" \| "cursor-agent"`). Used as the registry key and source of truth for agent identity. |
| `Loader` | Interface for feature installation with `name`, `description`, `run()`, `uninstall()`, and optional `validate()` methods |
| `ValidationResult` | Result type for loader validation checks (`valid`, `message`, `errors`) |
| `LoaderRegistry` | Interface that agent-specific registry classes must implement (`getAll()`, `getAllReversed()`) |

**Agent Interface** (agentRegistry.ts):
- `name`: `AgentName` - canonical identifier used as the registry key (e.g., "claude-code")
- `displayName`: Human-readable name (e.g., "Claude Code")
- `getLoaderRegistry()`: Returns an object implementing the `LoaderRegistry` interface
- `listProfiles({ installDir })`: Returns array of installed profile names from `~/.{agent}/profiles/`
- `listSourceProfiles()`: Returns array of `SourceProfile` objects from the package's source directory (for install UI profile selection)
- `switchProfile({ installDir, profileName })`: Validates profile exists, filters out config entries for uninstalled agents, and updates config
- `getGlobalFeatureNames()`: Returns human-readable names of features installed to the user's home directory for display in prompts (e.g., `["hooks", "statusline", "global slash commands"]` for claude-code)
- `getGlobalLoaderNames()`: Returns loader names for global features, used by uninstall to skip loaders when preserving global settings (e.g., `["hooks", "statusline", "slashcommands"]` for claude-code)

**SourceProfile Type** (agentRegistry.ts):
- `name`: Profile identifier (e.g., "senior-swe")
- `description`: Human-readable description from profile.json

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern with `getInstance()`
- `get({ name })`: Look up agent by name, throws if not found
- `list()`: Returns array of registered agent names
- `resetInstance()`: For test isolation

**Config Loader** (config/loader.ts):
- Shared loader that manages the `.nori-config.json` file lifecycle (single source of truth for config and version)
- All agents MUST include this loader in their registry
- Handles saving/removing config with auth credentials, profile selection, user preferences, and agent tracking (the `agents` object keys indicate which agents are installed)
- During install: Merges `agents` objects from existing and new config, saves current package version in the `version` field. Preserves existing agent profiles (ensures per-agent profiles set by `switchProfile` survive reinstallation)
- During uninstall: Removes the uninstalled agent from the `agents` object. If no agents remain, deletes `.nori-config.json`. If agents remain, updates config with remaining agents and preserves the file (including the `version` field)

**Migration System** (migration.ts):
- Versioned migration system for transforming config between formats during installation
- The `migrate()` function applies all migrations newer than `previousVersion` in semver order
- Migrations are defined as `Migration` objects with `version`, `name`, and `migrate()` function
- The `migrate()` function throws if `previousVersion` is null/empty/invalid - configs without a version field require manual intervention
- Current migrations:
  - **v19.0.0 (consolidate-auth-and-profile-structure)**: Two transformations: (1) Flat auth fields (username/password/refreshToken/organizationUrl at root) → nested `auth: {...}` structure, removing flat fields regardless of outcome. (2) Legacy `profile` field → `agents["claude-code"].profile`, preserving existing agents config if present. Both transformations are idempotent.

### Things to Know

**`AgentName` is the canonical UID for agents.** The `AgentName` type (`"claude-code" | "cursor-agent"`) is the source of truth for valid agent identifiers. `Agent.name` is typed as `AgentName`, which ensures type safety. CLI entry points parse the `--agent` option string, look up the `Agent` object once via `AgentRegistry.get({ name })`, then pass the `Agent` object around. Functions that need the agent identifier access `agent.name` rather than receiving a separate string parameter. This pattern makes it impossible for the agent name and agent object to get out of sync.

**Loader descriptions must be noun phrases.** Loader `description` fields are displayed in both install and uninstall contexts. The uninstall command shows "The following will be removed:" followed by loader descriptions. Descriptions should be noun phrases (e.g., "Profile templates in ~/.claude/profiles/") not action verbs (e.g., "Install Nori profile templates...") so they read naturally in both contexts. Tests in @/src/cli/commands/uninstall/uninstall.test.ts enforce this convention.

**Critical: All agents must include the config loader.** The `configLoader` from @/src/cli/features/config/loader.ts manages the shared `.nori-config.json` file. Each agent's LoaderRegistry class must register this loader to ensure proper config file creation during install and removal during uninstall.

The AgentRegistry auto-registers all agents in its constructor. Currently claude-code and cursor-agent are registered. Adding new agents follows this pattern:
1. Create a new directory (e.g., `new-agent/`) with an agent implementation satisfying the Agent interface
2. Create a LoaderRegistry class implementing the `LoaderRegistry` interface, including the shared `configLoader`
3. Implement `getGlobalFeatureNames()` to declare which features are installed globally (for display in prompts)
4. Implement `getGlobalLoaderNames()` to declare which loaders correspond to global features (for uninstall skipping)
5. Import and register it in AgentRegistry's constructor

Commands that use loaders should obtain them via the agent rather than importing LoaderRegistry directly. This ensures the correct agent's loaders are used when `--agent` is specified.

Profile management is owned by the Agent interface. Two separate methods handle different profile use cases:
- `listProfiles({ installDir })`: Scans the agent's installed profiles directory (`~/.{agent}/profiles/`) for valid profiles (directories containing the agent's instruction file). Used when switching profiles after installation.
- `listSourceProfiles()`: Scans the package's source profiles directory (`profiles/config/`) and returns profiles with metadata. Used by the install command to present profile options to the user.

The `switchProfile` method validates the profile exists, updates the agent's profile in the `agents` object, and logs success/restart messages. CLI commands add additional behavior on top (e.g., applying changes immediately via reinstall).

Agent implementations manage their own internal paths (config directories, instruction file names, etc.) without exposing them through the public interface. This keeps the abstraction clean and allows each agent to have different directory structures. For example, Claude Code's path helpers (getClaudeDir, getClaudeSkillsDir, etc.) live in @/src/cli/features/claude-code/paths.ts rather than in the CLI-level @/src/cli/env.ts. The env.ts file re-exports these functions for backward compatibility, but new code within agent directories should import from the agent's own paths module.

Template substitution utilities are agent-specific. Each agent has its own template.ts that replaces agent-appropriate placeholders in content files. Claude Code (@/src/cli/features/claude-code/template.ts) uses `{{skills_dir}}` while Cursor (@/src/cli/features/cursor-agent/template.ts) uses `{{rules_dir}}`. Both support common placeholders: `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}`.

Created and maintained by Nori.
