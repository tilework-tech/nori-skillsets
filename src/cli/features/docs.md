# Noridoc: features

Path: @/src/cli/features

### Overview

Multi-agent abstraction layer that defines the Agent interface and registry for supporting multiple AI agents through a unified CLI interface. Currently supports Claude Code and Cursor. Contains shared types (`Loader`, `ValidationResult`, `LoaderRegistry`) that all agents implement, plus the shared config loader that all agents must include. Also contains shared test utilities (@/src/cli/features/test-utils/) used across agent and command tests.

### How it fits into the larger codebase

The features directory sits between the CLI commands (@/src/cli/commands/) and agent-specific implementations (e.g., @/src/cli/features/claude-code/). CLI commands use the AgentRegistry to look up agent implementations by name, then delegate to the agent's loaders and profile methods.

```
CLI Commands (install, switch-profile)
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
- `listProfiles({ installDir })`: Returns array of installed profile names (Claude Code uses `~/.nori/profiles/`)
- `switchProfile({ installDir, profileName })`: Validates profile exists, filters out config entries for uninstalled agents, and updates config
- `getGlobalLoaders()`: Returns array of `GlobalLoader` objects with loader names and human-readable names

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

**Migration System** (migration.ts):
- Versioned migration system for transforming config between formats during installation
- The `migrate()` function applies all migrations newer than `previousVersion` in semver order
- Current migrations:
  - **v19.0.0 (consolidate-auth-and-profile-structure)**: Flat auth fields to nested `auth: {...}` structure; legacy `profile` field to `agents["claude-code"].profile`
  - **v20.0.0 (move-profiles-to-nori-directory)**: Removes the old `~/.claude/profiles/` directory to clean up after migration to `~/.nori/profiles/`

### Things to Know

**`AgentName` is the canonical UID for agents.** The `AgentName` type (`"claude-code" | "cursor-agent"`) is the source of truth for valid agent identifiers. CLI entry points parse the `--agent` option string, look up the `Agent` object once via `AgentRegistry.get({ name })`, then pass the `Agent` object around. Functions that need the agent identifier access `agent.name` rather than receiving a separate string parameter.

**Loader descriptions must be noun phrases.** Loader `description` fields are displayed in install contexts. Descriptions should be noun phrases (e.g., "Profile templates in ~/.claude/profiles/") not action verbs (e.g., "Install Nori profile templates...").

**Critical: All agents must include the config loader.** The `configLoader` from @/src/cli/features/config/loader.ts manages the shared `.nori-config.json` file. Each agent's LoaderRegistry class must register this loader to ensure proper config file creation during install.

The AgentRegistry auto-registers all agents in its constructor. Currently claude-code and cursor-agent are registered.

Profile management is owned by the Agent interface. The `listProfiles({ installDir })` method scans the agent's installed profiles directory for valid profiles (directories containing the agent's instruction file). Since no built-in profiles are shipped with the package, profiles are obtained exclusively from the registry or created by users.

Agent implementations manage their own internal paths (config directories, instruction file names, etc.) without exposing them through the public interface. Claude Code's path helpers live in @/src/cli/features/claude-code/paths.ts. The env.ts file re-exports these functions for backward compatibility.

Template substitution utilities are agent-specific. Claude Code (@/src/cli/features/claude-code/template.ts) uses `{{skills_dir}}` while Cursor (@/src/cli/features/cursor-agent/template.ts) uses `{{rules_dir}}`. Both support common placeholders: `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}`.

Created and maintained by Nori.
