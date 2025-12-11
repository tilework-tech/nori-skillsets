# Noridoc: cursor-agent

Path: @/src/cli/features/cursor-agent

### Overview

Cursor agent implementation that satisfies the Agent interface from @/src/cli/features/agentRegistry.ts. Contains feature loaders and configurations for installing Nori components into Cursor IDE. Uses a directory-based profile system where each profile contains AGENTS.md and rules. Uses AGENTS.md (instead of CLAUDE.md) and rules/ with RULE.md files (instead of skills/ with SKILL.md). Cursor-specific path helpers are encapsulated in paths.ts within this directory.

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
- `listSourceProfiles()`: Scans package's `profiles/config/` for directories with `profile.json`, returns `SourceProfile[]` with name and description
- `switchProfile({ installDir, profileName })`: Validates profile exists, updates config's `agents["cursor-agent"]` field, logs success message
- `getGlobalFeatureNames()`: Returns `["hooks", "slash commands"]` - human-readable names for prompts (note: cursor-agent has no statusline feature unlike claude-code)
- `getGlobalLoaderNames()`: Returns `["hooks", "slashcommands"]` - loader names used by uninstall to skip global loaders when `removeGlobalSettings` is false

The AgentRegistry (@/src/cli/features/agentRegistry.ts) registers this agent alongside claude-code. CLI commands use `--agent cursor-agent` to target Cursor installation.

### Core Implementation

**CursorLoaderRegistry** (loaderRegistry.ts): Singleton registry implementing the shared `LoaderRegistry` interface from @/src/cli/features/agentRegistry.ts. Registers the shared `configLoader` (from @/src/cli/features/config/loader.ts), `profilesLoader`, `hooksLoader`, and `slashCommandsLoader`. Provides `getAll()` and `getAllReversed()` for install/uninstall ordering. The config loader must be included to manage the shared `.nori-config.json` file.

**profilesLoader** (profiles/loader.ts): Orchestrates profile installation with mixin composition:
1. Reading profile.json metadata to get mixins configuration
2. Injecting conditional mixins for paid users (`paid`, `{category}-paid`)
3. Composing profile by merging mixin content in alphabetical order (directories merge, files use last-writer-wins)
4. Overlaying profile-specific content (AGENTS.md, profile.json)
5. Copying composed profiles to `~/.cursor/profiles/`
6. Invoking sub-loaders via CursorProfileLoaderRegistry in order: rules, agentsmd

**CursorProfileLoaderRegistry** (profiles/profileLoaderRegistry.ts): Singleton registry for profile-dependent sub-loaders. Registration order matters: rules before agentsmd.

**rulesLoader** (profiles/rules/loader.ts): Copies rule files from the selected profile's `rules/` directory to `~/.cursor/rules/`. Each rule is a directory containing `RULE.md`.

**agentsMdLoader** (profiles/agentsmd/loader.ts): Manages the `AGENTS.md` file at project root using a managed block pattern (BEGIN/END NORI-AI MANAGED BLOCK). Reads AGENTS.md content from the selected profile and inserts/updates it within the managed block, preserving any user content outside the block.

**hooksLoader** (hooks/loader.ts): Configures Cursor IDE hooks for desktop notifications. Manages `~/.cursor/hooks.json` using Cursor's hooks schema (`{ version: 1, hooks: { stop: [...] } }`). Adds a notify-hook.sh script to the `stop` event, which fires when the Cursor agent loop completes. The loader handles idempotent installation (avoids duplicate hooks), clean uninstallation (removes only Nori hooks), and validation.

**slashCommandsLoader** (slashcommands/loader.ts): Installs Nori slash commands to `~/.cursor/commands/`. Reads `.md` files from the `slashcommands/config/` directory, applies template substitution via @/src/cli/features/cursor-agent/template.ts, and writes them to the target directory. Uninstall removes installed commands and cleans up the commands directory if empty.

### Things to Know

**Path Helpers (paths.ts):** All Cursor-specific path functions live in @/src/cli/features/cursor-agent/paths.ts:

| Function | Returns |
|----------|---------|
| `getCursorDir({ installDir })` | `{installDir}/.cursor` |
| `getCursorProfilesDir({ installDir })` | `{installDir}/.cursor/profiles` |
| `getCursorRulesDir({ installDir })` | `{installDir}/.cursor/rules` |
| `getCursorAgentsMdFile({ installDir })` | `{installDir}/AGENTS.md` |
| `getCursorHooksFile({ installDir })` | `{installDir}/.cursor/hooks.json` |
| `getCursorCommandsDir({ installDir })` | `{installDir}/.cursor/commands` |

**Key differences from claude-code:**
- Uses AGENTS.md instead of CLAUDE.md for instructions
- Uses rules/ directory with RULE.md files instead of skills/ with SKILL.md
- Rules use Cursor's YAML frontmatter format with `description` and `alwaysApply: false` (no globs - uses "Apply Intelligently" mode)
- Target directory is ~/.cursor instead of ~/.claude
- Cursor hooks use a simpler event model (e.g., `stop`) compared to Claude Code's hooks (e.g., `SessionEnd`)

**Hooks architecture:** The hooks/ directory contains the hooksLoader and a config/ subdirectory with hook scripts. The notify-hook.sh script is a cross-platform bash script supporting Linux (notify-send), macOS (osascript/terminal-notifier), and Windows (PowerShell). Cursor's hooks.json format is `{ version: 1, hooks: { [event]: [{ command: "..." }] } }`. The loader identifies Nori hooks by checking if the command path contains "notify-hook.sh".

**Mixin composition system**: Profiles specify mixins in profile.json as `{"mixins": {"base": {}, "swe": {}}}`. The loader processes mixins in alphabetical order for deterministic precedence. When multiple mixins provide the same file, last writer wins. When multiple mixins provide the same directory, contents are merged. Conditional mixins are automatically injected based on user tier (see @/src/cli/features/cursor-agent/profiles/loader.ts).

**Template substitution (template.ts):** Cursor-specific placeholders for content files. Replaces `{{rules_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, and `{{install_dir}}` with absolute paths. This is distinct from claude-code's template.ts which uses `{{skills_dir}}` instead of `{{rules_dir}}`.

**Profile structure:** Each profile directory in `profiles/config/` contains:
- `AGENTS.md`: Instructions file (required for profile to be listed)
- `profile.json`: Profile metadata with `mixins` field specifying which mixins to compose
- `rules/`: Directory containing rule subdirectories, each with a RULE.md (typically inherited from mixins)

**Mixin content:**
- `_base` mixin: Contains `using-rules` rule for rule usage guidance
- `_swe` mixin: Contains software engineering rules mirroring claude-code skills (test-driven-development, systematic-debugging, brainstorming, etc.)

**Managed block pattern:** AGENTS.md uses the same managed block pattern as claude-code's CLAUDE.md, allowing users to add custom content outside the `# BEGIN NORI-AI MANAGED BLOCK` / `# END NORI-AI MANAGED BLOCK` markers without losing it during reinstalls.

**Default profile:** Falls back to "amol" if no profile is configured in nori-config.json's `agents["cursor-agent"].profile.baseProfile`.

Created and maintained by Nori.
