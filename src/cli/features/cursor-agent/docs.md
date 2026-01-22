# Noridoc: cursor-agent

Path: @/src/cli/features/cursor-agent

### Overview

Cursor agent implementation that satisfies the Agent interface from @/src/cli/features/agentRegistry.ts. Contains feature loaders and configurations for installing Nori components into Cursor IDE. Uses a directory-based profile system where each profile is self-contained with AGENTS.md and rules. Uses AGENTS.md (instead of CLAUDE.md) and rules/ with RULE.md files (instead of skills/ with SKILL.md). Cursor-specific path helpers are encapsulated in paths.ts within this directory.

### How it fits into the larger codebase

```
CLI Commands (install, uninstall, check, switch-profile)
    |
    +-- AgentRegistry.getInstance().get({ name: "cursor-agent" })
    |
    +-- cursorAgent (agent.ts)
        |
        +-- getLoaderRegistry() --> CursorLoaderRegistry
        |       |
        |       +-- profilesLoader --> CursorProfileLoaderRegistry
        |       |       |
        |       |       +-- rulesLoader
        |       |       +-- subagentsLoader
        |       |       +-- agentsMdLoader
        |       |
        |       +-- hooksLoader --> configures ~/.cursor/hooks.json
        |       +-- slashCommandsLoader
        |
        +-- listProfiles({ installDir }) --> scans ~/.cursor/profiles/
        +-- switchProfile({ installDir, profileName })
```

The cursor-agent follows the same architectural pattern as claude-code. The `cursorAgent` object in agent.ts provides:
- `name`: "cursor-agent"
- `displayName`: "Cursor Agent"
- `getLoaderRegistry()`: Returns the CursorLoaderRegistry singleton
- `listProfiles({ installDir })`: Scans installed `.cursor/profiles/` for directories containing `AGENTS.md`
- `listSourceProfiles()`: Scans package's `profiles/config/` for directories with `nori.json` (falls back to `profile.json`), returns `SourceProfile[]` with name and description
- `switchProfile({ installDir, profileName })`: Validates profile exists, filters out config entries for uninstalled agents, updates config's `agents["cursor-agent"]` field, logs success message
- `getGlobalFeatureNames()`: Returns `["hooks", "slash commands"]` - human-readable names for prompts
- `getGlobalLoaderNames()`: Returns `["hooks", "slashcommands"]` - loader names used by uninstall to skip global loaders

The AgentRegistry (@/src/cli/features/agentRegistry.ts) registers this agent alongside claude-code. CLI commands use `--agent cursor-agent` to target Cursor installation.

### Core Implementation

**CursorLoaderRegistry** (loaderRegistry.ts): Singleton registry implementing the shared `LoaderRegistry` interface from @/src/cli/features/agentRegistry.ts. Registers the shared `configLoader`, `profilesLoader`, `hooksLoader`, and `slashCommandsLoader`. Provides `getAll()` and `getAllReversed()` for install/uninstall ordering.

**profilesLoader** (profiles/loader.ts): Copies self-contained profile directories directly from config/ to `~/.cursor/profiles/`. Each profile contains all its content (rules/, subagents/, AGENTS.md) without any composition needed. Invokes sub-loaders via CursorProfileLoaderRegistry in order: rules, subagents, agentsmd.

**CursorProfileLoaderRegistry** (profiles/profileLoaderRegistry.ts): Singleton registry for profile-dependent sub-loaders. Registration order matters: rules, subagents, then agentsmd (AGENTS.md references both rules and subagents).

**rulesLoader** (profiles/rules/loader.ts): Copies rule files from the selected profile's `rules/` directory to `~/.cursor/rules/`. Each rule is a directory containing `RULE.md`. The loader preserves user-created rules by only managing Nori rules.

**subagentsLoader** (profiles/subagents/loader.ts): Copies subagent prompt files from the selected profile's `subagents/` directory to `~/.cursor/subagents/`. Each subagent is a `.md` file defining a specialized AI assistant.

**agentsMdLoader** (profiles/agentsmd/loader.ts): Manages the `AGENTS.md` file at project root using a managed block pattern (BEGIN/END NORI-AI MANAGED BLOCK).

**hooksLoader** (hooks/loader.ts): Configures Cursor IDE hooks for desktop notifications and slash command interception. Manages `~/.cursor/hooks.json`.

**slashCommandsLoader** (slashcommands/loader.ts): Installs Nori slash commands to `~/.cursor/commands/`.

### Things to Know

**Path Helpers (paths.ts):** All Cursor-specific path functions live in @/src/cli/features/cursor-agent/paths.ts. There are two categories:

**Project-relative paths** (take `installDir` param):

| Function | Returns |
|----------|---------|
| `getCursorDir({ installDir })` | `{installDir}/.cursor` |
| `getCursorProfilesDir({ installDir })` | `{installDir}/.cursor/profiles` |
| `getCursorRulesDir({ installDir })` | `{installDir}/.cursor/rules` |
| `getCursorAgentsMdFile({ installDir })` | `{installDir}/AGENTS.md` |
| `getCursorHooksFile({ installDir })` | `{installDir}/.cursor/hooks.json` |
| `getCursorCommandsDir({ installDir })` | `{installDir}/.cursor/commands` |
| `getCursorSubagentsDir({ installDir })` | `{installDir}/.cursor/subagents` |

**Home-based paths** (no params):

| Function | Returns |
|----------|---------|
| `getCursorHomeDir()` | `~/.cursor` |
| `getCursorHomeHooksFile()` | `~/.cursor/hooks.json` |
| `getCursorHomeCommandsDir()` | `~/.cursor/commands` |

**Key differences from claude-code:**
- Uses AGENTS.md instead of CLAUDE.md for instructions
- Uses rules/ directory with RULE.md files instead of skills/ with SKILL.md
- Rules use Cursor's YAML frontmatter format with `description` and `alwaysApply: false`
- Target directory is ~/.cursor instead of ~/.claude

**Hooks architecture:** The hooks/ directory contains the hooksLoader and a config/ subdirectory with hook scripts and intercepted slash commands. The notify-hook.sh script is cross-platform supporting Linux, macOS, and Windows. The slash-command-intercept.ts handles slash command interception.

**format.ts uses plain text (not ANSI codes):** Unlike claude-code which runs in a terminal, cursor-agent's hook output is displayed in Cursor IDE's web-based chat UI. Therefore, cursor-agent's format.ts uses Unicode symbols (for success/error) instead of ANSI colors.

**Intercepted slash commands:** Slash commands registered in `intercepted-slashcommands/registry.ts` are executed directly without LLM inference overhead.

**Self-contained profiles**: Each profile contains all content it needs directly. There is no mixin composition, inheritance, or conditional injection. Profiles are copied as-is to `~/.cursor/profiles/`.

**Template substitution (template.ts):** Cursor-specific placeholders for content files. Replaces `{{rules_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, `{{subagents_dir}}`, and `{{install_dir}}` with absolute paths.

**Profile structure:** Each profile directory in `profiles/config/` contains:
- `AGENTS.md`: Instructions file (required for profile to be listed)
- `nori.json`: Unified manifest with name, version, description, and optional dependencies
- `rules/`: Directory containing rule subdirectories
- `subagents/`: Directory containing subagent .md files

**Available profiles:**

| Profile | Description |
|---------|-------------|
| amol | Opinionated workflow with TDD, structured planning, rule-based guidance |
| senior-swe | Dual-mode: "copilot" (interactive) or "full-send" (autonomous) |
| product-manager | High technical autonomy, product-focused questions, auto-creates PRs |
| none | Minimal infrastructure only, no behavioral modifications |

**Subagents system:** Cursor lacks a built-in Task tool like Claude Code. Subagents provide equivalent functionality by invoking `cursor-agent` CLI in headless mode.

**Managed block pattern:** AGENTS.md uses the same managed block pattern as claude-code's CLAUDE.md, allowing users to add custom content outside the managed markers.

**Default profile:** Falls back to "amol" if no profile is configured.

Created and maintained by Nori.
