# Noridoc: features

Path: @/src/cli/features

### Overview

Multi-agent abstraction layer that defines the Agent interface and registry for supporting multiple AI agents through a unified CLI interface. Currently supports Claude Code and Cursor. Each agent implementation provides its own LoaderRegistry and profile management methods.

### How it fits into the larger codebase

The features directory sits between the CLI commands (@/src/cli/commands/) and agent-specific implementations (e.g., @/src/cli/features/claude-code/). CLI commands use the AgentRegistry to look up agent implementations by name, then delegate to the agent's loaders and profile methods.

```
CLI Commands (install, uninstall, check, switch-profile)
    |
    +-- AgentRegistry.getInstance().get({ name: agentName })
    |
    +-- Agent interface
        |
        +-- getLoaderRegistry() --> LoaderRegistry with agent's loaders
        +-- listProfiles({ installDir }) --> Available profile names
        +-- switchProfile({ installDir, profileName }) --> Validate and switch
```

The `--agent` global CLI option (default: "claude-code") determines which agent implementation is used. Per-agent profile configuration is stored in the Config `agents` field.

### Core Implementation

**Agent Interface** (agentRegistry.ts):
- `name`: Unique identifier (e.g., "claude-code")
- `displayName`: Human-readable name (e.g., "Claude Code")
- `getLoaderRegistry()`: Returns the agent's LoaderRegistry
- `listProfiles({ installDir })`: Returns array of installed profile names from `~/.{agent}/profiles/`
- `listSourceProfiles()`: Returns array of `SourceProfile` objects from the package's source directory (for install UI profile selection)
- `switchProfile({ installDir, profileName })`: Validates profile exists and updates config

**SourceProfile Type** (agentRegistry.ts):
- `name`: Profile identifier (e.g., "senior-swe")
- `description`: Human-readable description from profile.json

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern with `getInstance()`
- `get({ name })`: Look up agent by name, throws if not found
- `list()`: Returns array of registered agent names
- `resetInstance()`: For test isolation

### Things to Know

The AgentRegistry auto-registers all agents in its constructor. Currently claude-code and cursor-agent are registered. Adding new agents follows this pattern:
1. Create a new directory (e.g., `new-agent/`) with an agent implementation satisfying the Agent interface
2. Import and register it in AgentRegistry's constructor

Commands that use loaders should obtain them via the agent rather than importing LoaderRegistry directly. This ensures the correct agent's loaders are used when `--agent` is specified.

Profile management is owned by the Agent interface. Two separate methods handle different profile use cases:
- `listProfiles({ installDir })`: Scans the agent's installed profiles directory (`~/.{agent}/profiles/`) for valid profiles (directories containing the agent's instruction file). Used when switching profiles after installation.
- `listSourceProfiles()`: Scans the package's source profiles directory (`profiles/config/`) and returns profiles with metadata. Used by the install command to present profile options to the user.

The `switchProfile` method validates the profile exists, updates the config, and logs success/restart messages. CLI commands add additional behavior on top (e.g., applying changes immediately via reinstall).

Agent implementations manage their own internal paths (config directories, instruction file names, etc.) without exposing them through the public interface. This keeps the abstraction clean and allows each agent to have different directory structures. For example, Claude Code's path helpers (getClaudeDir, getClaudeSkillsDir, etc.) live in @/src/cli/features/claude-code/paths.ts rather than in the CLI-level @/src/cli/env.ts. The env.ts file re-exports these functions for backward compatibility, but new code within agent directories should import from the agent's own paths module.

Template substitution utilities are agent-specific. Each agent has its own template.ts that replaces agent-appropriate placeholders in content files. Claude Code (@/src/cli/features/claude-code/template.ts) uses `{{skills_dir}}` while Cursor (@/src/cli/features/cursor-agent/template.ts) uses `{{rules_dir}}`. Both support common placeholders: `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}`.

Created and maintained by Nori.
