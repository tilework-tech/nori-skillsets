# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

The Claude Code agent implementation. This directory contains the `AgentConfig` declaration for Claude Code, Claude-Code-specific path utilities, a permissions loader, factory reset logic, and legacy loaders for Claude-specific features (hooks, statusline, announcements). Skillset-dependent features (instructions, skills, slashcommands, subagents) use shared loaders from @/src/cli/features/shared/.

### How it fits into the larger codebase

`agent.ts` exports `claudeCodeAgentConfig` (implements `AgentConfig`), which is imported directly by the `AgentRegistry` constructor in @/src/cli/features/agentRegistry.ts. CLI commands never call methods on `claudeCodeAgentConfig` directly for lifecycle operations -- they call shared functions from @/src/cli/features/agentOperations.ts, passing the agent config as a parameter.

The `claudeCodeAgentConfig` declares its ordered loader pipeline via `getLoaders()`:

1. `configLoader` (wrapped via `wrapLegacyLoader`) -- shared config persistence
2. `permissionsLoader` -- Claude-specific, configures `settings.json` permissions
3. `skillsLoader` -- shared, from @/src/cli/features/shared/skillsLoader.ts
4. `createInstructionsLoader({ managedFiles: ["CLAUDE.md"] })` -- shared, from @/src/cli/features/shared/instructionsLoader.ts
5. `createSlashCommandsLoader({ managedDirs: ["commands"] })` -- shared
6. `createSubagentsLoader({ managedDirs: ["agents"] })` -- shared
7. `hooksLoader` (wrapped via `wrapLegacyLoader`, `managedFiles: ["settings.json"]`)
8. `statuslineLoader` (wrapped via `wrapLegacyLoader`, `managedFiles: ["nori-statusline.sh", "settings.json"]`)
9. `announcementsLoader` (wrapped via `wrapLegacyLoader`, `managedFiles: ["settings.json"]`)

Agent-specific loaders (hooks, statusline, announcements) use the legacy `Loader` interface and are adapted via `wrapLegacyLoader()`, which maps the `{ config }` signature to the `{ agent, config, skillset }` signature expected by `AgentLoader`.

`permissionsLoader.ts` is a Claude-specific `AgentLoader` that configures `settings.json` to grant Claude Code read access to the profiles directory (`~/.nori/profiles/`) and the agent's skills directory. It consolidates permissions logic that was previously split across multiple files.

`paths.ts` centralizes Claude-Code-specific path computations (`getClaudeDir`, `getClaudeSettingsFile`, `getClaudeHomeDir`), distinguishing between the install directory (`{installDir}/.claude/`) and the home directory (`~/.claude/`). Hooks and statusline write to `~/.claude/settings.json` so they work from any subdirectory, while skillset-specific config writes to the install directory.

`factoryReset.ts` walks the ancestor directory tree to find and remove all `.claude/` directories and `CLAUDE.md` files. The `getArtifactPatterns()` function on the agent config declares `dirs: [".claude"]` and `files: ["CLAUDE.md"]`, which are used by the shared `findArtifacts()` operation in @/src/cli/features/agentOperations.ts.

### Core Implementation

The `claudeCodeAgentConfig` object declares:
- `name`: `"claude-code"`, `displayName`: `"Claude Code"`
- `description`: `"Instructions, skills, subagents, commands, hooks, statusline, watch"`
- Path getters mapping to `.claude/` subdirectories (`skills`, `agents`, `commands`, `CLAUDE.md`)
- `getTranscriptDirectory()`: Returns `~/.claude/projects` for the watch command
- `getArtifactPatterns()`: Returns `{ dirs: [".claude"], files: ["CLAUDE.md"] }` for factory reset artifact discovery

The managed files and directories are no longer hardcoded on the agent; they are derived from loader declarations by `getManagedFiles()` and `getManagedDirs()` in @/src/cli/features/agentOperations.ts.

### Things to Know

- The `wrapLegacyLoader()` function is defined locally in `agent.ts` (not shared) because it is a thin adapter. Each agent module has its own copy.
- `getTranscriptDirectory()` and `getArtifactPatterns()` are the two optional `AgentConfig` properties that Claude Code implements but Cursor does not. `getTranscriptDirectory` enables the watch command; `getArtifactPatterns` enables factory reset.
- Profile discovery (`listProfiles()`) is not part of the agent -- it lives in @/src/cli/features/managedFolder.ts.
- All lifecycle operations (install, switch, remove, detect changes, detect/capture existing config, find artifacts) are now in @/src/cli/features/agentOperations.ts, not on the agent object.

Created and maintained by Nori.
