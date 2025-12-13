# Noridoc: uninstall

Path: @/src/cli/commands/uninstall

### Overview

- Removes Nori Profiles features from the system, including agent-specific files (CLAUDE.md/AGENTS.md), profiles, skills, subagents, and slash commands
- Supports both interactive and non-interactive modes with different behaviors for config preservation
- Auto-detects which agent to uninstall from the config when `--agent` is not explicitly provided

### How it fits into the larger codebase

- Registered via `registerUninstallCommand()` called from @/src/cli/cli.ts
- Uses `AgentRegistry` (@/src/cli/features/agentRegistry.ts) to get agent-specific loaders
- Executes loaders in REVERSE order via `registry.getAllReversed()` - critical because profiles must be removed LAST (other loaders need profile directories to know what to remove)
- Called by the install command during upgrades to clean up the previous version before installing the new one
- Uses `getInstalledAgents({ config })` from @/src/cli/config.ts to detect which agents are installed at a location (derived from `agents` object keys)

### Core Implementation

**Entry Points:**

| Function | Mode | Config Preservation | Agent Detection |
|----------|------|---------------------|-----------------|
| `main()` | Routes to interactive/non-interactive | - | Passes through |
| `interactive()` | Prompts user | Removes config | Prompts if multiple agents |
| `noninteractive()` | No prompts | Preserves config | Auto-detects from config |

**Agent Detection in Non-Interactive Mode:**

When `--agent` is not explicitly provided, `noninteractive()` reads the config and uses `getInstalledAgents({ config })` to determine installed agents:
- If exactly one agent installed → uses that agent
- If zero agents or multiple agents → defaults to `claude-code`

This ensures that during autoupdate/upgrade scenarios, the correct agent is uninstalled without requiring explicit `--agent` flags.

**Interactive Mode Agent Selection:**

- If `--agent` provided → uses that agent
- If single agent installed → auto-selects it
- If multiple agents installed → displays numbered list and prompts user to select

**Loader Execution:**

Loaders execute in reverse order from install. Each loader's `uninstall({ config })` is called with the config containing `agents: { [agentName]: {...} }` so the loader knows which agent is being removed. Global loaders (hooks, statusline, slashcommands) can be skipped via `removeGlobalSettings: false`.

**Feature List Display:**

In interactive mode, the feature list ("The following will be removed:") is built dynamically from the agent's loader descriptions via `registry.getAll()` rather than hardcoded, ensuring each agent shows its own features.

### Things to Know

- **Reverse loader order is critical:** During install, profiles loader runs first to create directories. During uninstall, profiles must run LAST so other loaders can still access profile directories to determine which files to remove.

- **Config preservation during upgrades:** Non-interactive mode (used by install command during upgrades) preserves the config file and global settings. Only user-initiated uninstalls remove the config.

- **Global settings are shared:** Global features (hooks, statusline, global slash commands) are installed in `~/.claude/` and shared across all Nori installations. Interactive mode prompts about removing them; non-interactive mode always preserves them.

- **agents field:** The config loader uses the `agents` object to know which agent is being uninstalled. If other agents remain after uninstall, the config file is preserved with the remaining agents in the `agents` object.

- **Remaining agents messaging:** When uninstalling one agent while others remain, the uninstall command displays a message listing the remaining agents and provides the command to uninstall them (e.g., `nori-ai uninstall --agent cursor-agent`).

- **Config loader is the single source of truth:** The config loader manages the `.nori-config.json` file lifecycle (version is now stored in the config file's `version` field). The uninstall command delegates all config file operations to the config loader rather than handling file deletion directly.

Created and maintained by Nori.
