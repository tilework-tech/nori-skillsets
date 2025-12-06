# Noridoc: agents

Path: @/plugin/src/cli/agents

### Overview

Multi-agent support infrastructure enabling Nori to install configurations for different coding agents. Contains the AgentRegistry singleton that maps agent names to their configurations, and agent-specific directories (currently only `claude/`) containing feature loaders and profile configurations.

### How it fits into the larger codebase

```
CLI Command Flow with Multi-Agent Support:

nori-ai --agent <name> install
         |
         v
    cli.ts (validates --agent via AgentRegistry)
         |
         v
    AgentRegistry.getInstance()
         |
         +-- getAgent({ name }) --> AgentConfig
         |         |
         |         +-- name: "claude-code"
         |         +-- description: "Claude Code - Anthropic's AI coding assistant"
         |         +-- getLoaderRegistry() --> LoaderRegistry
         |         +-- getSourceProfilesDir() --> profiles/config path
         |
         v
    Command execution (install, uninstall, etc.)
         |
         v
    LoaderRegistry from agent's directory
         |
         v
    Feature loaders (hooks, profiles, statusline, etc.)
```

**Two-Tier Registry Architecture:**
- **AgentRegistry** (`agentRegistry.ts`): Maps agent names (e.g., "claude-code") to AgentConfig objects. Each AgentConfig provides access to the agent's LoaderRegistry and profile source directory.
- **LoaderRegistry** (`claude/loaderRegistry.ts`): Agent-specific registry of feature loaders (hooks, profiles, statusline, announcements, config, version) that execute during install/uninstall.

**CLI Integration:** The CLI (`@/plugin/src/cli/cli.ts`) accepts a global `--agent <name>` option that defaults to "claude-code". The agent name is validated against AgentRegistry; invalid names throw an error listing valid options. Commands access the selected agent's configuration to determine which loaders and profiles to use.

**Config Tracking:** The `installedAgents` field in Config (`@/plugin/src/cli/config.ts`) persists an array of installed agent names to `.nori-config.json`. This enables tracking which agents are currently installed for future multi-agent management.

**Future Extensibility:** Adding a new agent requires:
1. Creating a new directory under `agents/` (e.g., `agents/cline/`)
2. Implementing a LoaderRegistry with agent-specific loaders
3. Registering the agent in AgentRegistry constructor

### Core Implementation

**AgentRegistry Class (`agentRegistry.ts`):**
- Singleton pattern via `getInstance()`
- Maps agent names to AgentConfig objects
- `getAgent({ name })` - retrieves config, throws on invalid name
- `getAllAgents()` - returns all registered agent configurations
- `getDefaultAgent()` / `getDefaultAgentName()` - returns default ("claude-code")

**AgentConfig Type:**
| Field | Type | Description |
|-------|------|-------------|
| name | string | Unique agent identifier (e.g., "claude-code") |
| description | string | Human-readable description |
| getLoaderRegistry | () => LoaderRegistry | Returns the agent's feature loader registry |
| getSourceProfilesDir | () => string | Returns absolute path to agent's profile configs |

**Currently Registered Agents:**
- `claude-code` - Claude Code agent with loaders for hooks, profiles, statusline, announcements, config, and version

### Things to Know

The directory restructure moved all files from `src/cli/features/` to `src/cli/agents/claude/`. All `@/cli/features/` imports throughout the codebase were updated to `@/cli/agents/claude/`.

The AgentRegistry is instantiated early in CLI startup and cached as a singleton. The `--agent` option validation happens during Commander.js option parsing, before any command executes.

The `installedAgents` config field is validated as an array of strings during config load. Empty arrays are not persisted (filtered out in `saveConfig`).

Created and maintained by Nori.
