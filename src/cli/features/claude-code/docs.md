# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

The Claude Code agent implementation. This directory contains the `AgentConfig` declaration for Claude Code, Claude-Code-specific path utilities, factory reset logic, and agent-specific loaders for Claude-specific features (hooks, statusline, announcements). Skillset-dependent features (instructions, skills, slashcommands, subagents) use shared loaders from @/src/cli/features/shared/.

### How it fits into the larger codebase

`agent.ts` exports `claudeCodeAgentConfig` (implements `AgentConfig`), which is imported directly by the `AgentRegistry` constructor in @/src/cli/features/agentRegistry.ts. CLI commands never call methods on `claudeCodeAgentConfig` directly for lifecycle operations -- they call shared functions from @/src/cli/features/agentOperations.ts, passing the agent config as a parameter.

The `claudeCodeAgentConfig` declares its ordered loader pipeline via `getLoaders()`:

1. `configLoader` -- shared config persistence, from @/src/cli/features/configLoader.ts
2. `skillsLoader` -- shared, from @/src/cli/features/shared/skillsLoader.ts
3. `createInstructionsLoader({ managedFiles: ["CLAUDE.md"] })` -- shared, from @/src/cli/features/shared/instructionsLoader.ts
4. `createSlashCommandsLoader({ managedDirs: ["commands"] })` -- shared
5. `createSubagentsLoader({ managedDirs: ["agents"] })` -- shared
6. `hooksLoader` (`managedFiles: ["settings.json"]`) -- Claude-specific
7. `statuslineLoader` (`managedFiles: ["nori-statusline.sh", "settings.json"]`) -- Claude-specific
8. `announcementsLoader` (`managedFiles: ["settings.json"]`) -- Claude-specific

All loaders implement the `AgentLoader` interface directly.

`paths.ts` provides home-level path helpers (`getClaudeHomeDir`, `getClaudeHomeSettingsFile`, `getClaudeHomeCommandsDir`) that always resolve to `~/.claude/`. These are used by hooks, statusline, and announcements loaders which write to `~/.claude/settings.json` so they work from any subdirectory. Install-directory paths (e.g., `{installDir}/.claude/`) are handled inline in the `AgentConfig` in `agent.ts` via path getters (`getAgentDir`, `getSkillsDir`, etc.).

`factoryReset.ts` walks the ancestor directory tree to find and remove all `.claude/` directories and `CLAUDE.md` files. The `getArtifactPatterns()` function on the agent config declares `dirs: [".claude"]` and `files: ["CLAUDE.md"]`, which are used by the shared `findArtifacts()` operation in @/src/cli/features/agentOperations.ts.

### Core Implementation

The `claudeCodeAgentConfig` object declares:
- `name`: `"claude-code"`, `displayName`: `"Claude Code"`
- `description`: `"Instructions, skills, subagents, commands, hooks, statusline, watch"`
- Path getters mapping to `.claude/` subdirectories (`skills`, `agents`, `commands`, `CLAUDE.md`)
- `getTranscriptDirectory()`: Returns `~/.claude/projects` for the watch command
- `getArtifactPatterns()`: Returns `{ dirs: [".claude"], files: ["CLAUDE.md"] }` for factory reset artifact discovery

The managed files and directories are derived from loader declarations by `getManagedFiles()` and `getManagedDirs()` in @/src/cli/features/agentOperations.ts.

### Things to Know

- `getTranscriptDirectory()` and `getArtifactPatterns()` are the two optional `AgentConfig` properties that Claude Code implements but Cursor does not. `getTranscriptDirectory` enables the watch command; `getArtifactPatterns` enables factory reset.
- Profile discovery (`listSkillsets()`) is not part of the agent -- it lives in @/src/norijson/skillset.ts.
- All lifecycle operations (install, switch, remove, detect changes, detect/capture existing config, find artifacts) are in @/src/cli/features/agentOperations.ts, not on the agent object.

Created and maintained by Nori.
