# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

Claude-Code-specific feature code: home-level path utilities, factory reset logic, and the agent-specific loaders for Claude-only features (hooks, statusline, announcements). This is the only agent with its own directory -- everything else about Claude Code (paths, MCP binding, loader pipeline) is declared as a row in the agent table at @/src/cli/features/agentTable.ts. Skillset-dependent features (instructions, skills, slashcommands, subagents) use shared loaders from @/src/cli/features/shared/.

### How it fits into the larger codebase

Claude Code's `AgentConfig` is built by `buildAgentConfig` from its `AgentDefinition` row in @/src/cli/features/agentTable.ts, like every other agent. That row references the code in this directory: `extraLoaders` (hooks, statusline, announcements), `externalSettingsFiles` (via `getClaudeHomeSettingsFile` from `paths.ts`), `legacyManifestPath` (via `getLegacyManifestPath` from @/src/cli/features/manifest.ts), `transcriptDirectory` (`~/.claude/projects`), and `artifactPatterns` (`.claude` dirs and `CLAUDE.md` files). CLI commands never call agent code directly for lifecycle operations -- they call shared functions from @/src/cli/features/agentOperations.ts, passing the agent config as a parameter.

The loader pipeline is assembled by `buildAgentConfig`: the shared set (`configLoader`, `skillsLoader`, instructions/slashcommands/subagents loaders), then the MCP loader from the row's `mcp` binding (project scope writes the entire `.mcp.json` at the install directory root via `whole-file`; user scope grafts canonical entries into `~/.claude.json` under `mcpServers` via `merge-mcp-servers-key`), then the row's `extraLoaders`:

1. `hooksLoader` (`managedFiles: ["settings.json"]`) -- from `hooks/`
2. `statuslineLoader` (`managedFiles: ["nori-statusline.sh", "settings.json"]`) -- from `statusline/`
3. `announcementsLoader` (`managedFiles: ["settings.json"]`) -- from `announcements/`

All loaders implement the `AgentLoader` interface directly.

`paths.ts` provides home-level path helpers (`getClaudeHomeDir`, `getClaudeHomeSettingsFile`, `getClaudeHomeCommandsDir`) that always resolve to `~/.claude/`. These are used by hooks, statusline, and announcements loaders which write to `~/.claude/settings.json` so they work from any subdirectory. Install-directory paths (e.g., `{installDir}/.claude/`) are derived from the table row's `agentDirSegments` by `buildAgentConfig`'s path getters (`getAgentDir`, `getSkillsDir`, etc.).

The row's `externalSettingsFiles` declares `~/.claude/settings.json` as an external file that should be backed up before loaders run and restored on uninstall. The backup/restore lifecycle is handled by @/src/cli/features/settingsBackup.ts and orchestrated in @/src/cli/features/agentOperations.ts.

`factoryReset.ts` walks the ancestor directory tree to find and remove all `.claude/` directories and `CLAUDE.md` files. The row's `artifactPatterns` (`dirs: [".claude"]`, `files: ["CLAUDE.md"]`) feed the shared `findArtifacts()` operation in @/src/cli/features/agentOperations.ts.

### Core Implementation

The claude-code `AgentDefinition` row declares:
- `name: "claude-code"`, `displayName: "Claude Code"`, `supportTier: "supported"`
- Path data mapping to `.claude/` subdirectories (`skills`, `agents`, `commands`, `CLAUDE.md`)
- `transcriptDirectory`: `~/.claude/projects` for the watch command
- `artifactPatterns` for factory reset artifact discovery
- `legacyManifestPath` for cleanup/detection of pre-per-agent-manifest installs

The `description` and `capabilities` (mcp/hooks/statusline/transcripts) are derived from the row by `buildAgentConfig`, not hand-maintained. The managed files and directories are derived from loader declarations by `getManagedFiles()` and `getManagedDirs()` in @/src/cli/features/agentOperations.ts.

### Things to Know

- Claude Code is the only agent that declares `extraLoaders`, `externalSettingsFiles`, `legacyManifestPath`, and `transcriptDirectory` on its row. It is also the `DEFAULT_AGENT_NAME` in @/src/cli/features/agentTable.ts.
- Shared operations never branch on `agent.name`; claude-code quirks like the legacy manifest are reached through optional `AgentConfig` accessors (e.g., `getLegacyManifestPath`).
- Profile discovery (`listSkillsets()`) is not part of the agent -- it lives in @/src/norijson/skillset.ts.
- All lifecycle operations (install, switch, remove, detect changes, detect/capture existing config, find artifacts) are in @/src/cli/features/agentOperations.ts, not on the agent object.
- The hooks, statusline, and announcements loaders all read-modify-write `~/.claude/settings.json`, a file Nori does not exclusively own. They do so via the safe primitives in @/src/utils/jsonFile.ts: a missing file seeds a fresh object (with the JSON-schema default), a corrupt file makes the loader abort loudly rather than overwrite the user's settings, and the write is atomic (temp-file + `rename`).

Created and maintained by Nori.
