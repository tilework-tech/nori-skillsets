# Noridoc: features

Path: @/src/cli/features

### Overview

Multi-agent abstraction layer that defines the Agent interface and registry for supporting multiple AI agents (Claude Code, Cursor, etc.) through a unified CLI interface. Each agent implementation provides its own LoaderRegistry and environment paths.

### How it fits into the larger codebase

The features directory sits between the CLI commands (@/src/cli/commands/) and agent-specific implementations (e.g., @/src/cli/features/claude-code/). CLI commands use the AgentRegistry to look up agent implementations by name, then delegate to the agent's loaders for installation/uninstallation/validation.

```
CLI Commands (install, uninstall, check, switch-profile)
    |
    +-- AgentRegistry.getInstance().get({ name: agentName })
    |
    +-- Agent interface
        |
        +-- getLoaderRegistry() --> LoaderRegistry with agent's loaders
        +-- getEnvPaths({ installDir }) --> Agent-specific paths
```

The `--agent` global CLI option (default: "claude-code") determines which agent implementation is used. Per-agent profile configuration is stored in the Config `agents` field.

### Core Implementation

**Agent Interface** (agentRegistry.ts):
- `name`: Unique identifier (e.g., "claude-code")
- `displayName`: Human-readable name (e.g., "Claude Code")
- `getLoaderRegistry()`: Returns the agent's LoaderRegistry
- `getEnvPaths({ installDir })`: Returns AgentEnvPaths for CLI operations

**AgentEnvPaths Type** (agentRegistry.ts):
| Field | Description | Example (Claude Code) |
|-------|-------------|----------------------|
| profilesDir | Profiles directory | ".claude/profiles" |
| instructionsFile | Main instructions file | ".claude/CLAUDE.md" |

Note: Only paths actually needed by CLI commands are exposed. Agent implementations may use additional internal paths.

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern with `getInstance()`
- `get({ name })`: Look up agent by name, throws if not found
- `list()`: Returns array of registered agent names
- `resetInstance()`: For test isolation

### Things to Know

The AgentRegistry auto-registers all agents in its constructor. Currently only claude-code is registered, but the architecture supports adding new agents by:
1. Creating a new directory (e.g., `cursor/`) with an agent implementation
2. Importing and registering it in AgentRegistry's constructor

Commands that use loaders should obtain them via the agent rather than importing LoaderRegistry directly. This ensures the correct agent's loaders are used when `--agent` is specified.

The switch-profile command uses `getAgentProfile({ config, agentName })` from config.ts to read/write per-agent profiles, maintaining backwards compatibility with the legacy `profile` field for claude-code.

Created and maintained by Nori.
