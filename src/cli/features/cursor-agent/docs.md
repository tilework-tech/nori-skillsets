# Noridoc: cursor-agent

Path: @/src/cli/features/cursor-agent

### Overview

The Cursor agent implementation. This directory contains the `AgentConfig` declaration for Cursor IDE. All path computations are inline in the `AgentConfig` in `agent.ts`. The agent uses shared loaders from @/src/cli/features/shared/ for all skillset-dependent features and has no agent-specific loaders beyond the shared `configLoader`.

### How it fits into the larger codebase

- `agent.ts` exports `cursorAgentConfig` (implements `AgentConfig`), which is imported directly by the `AgentRegistry` constructor in @/src/cli/features/agentRegistry.ts. CLI commands interact with this agent through shared operations in @/src/cli/features/agentOperations.ts, not through methods on the agent object.
- All agents share the same `activeSkillset` in the Config -- switching skillsets applies to all agents.
- All shared loaders read from the same `~/.nori/profiles/` directory as Claude Code, using `parseSkillset()` from @/src/norijson/skillset.ts. The skillset's `CLAUDE.md` is the source config file; the shared `createInstructionsLoader` handles writing it to `.cursor/rules/AGENTS.md` via `agent.getInstructionsFilePath()`.
- Template substitution uses the `.cursor` directory as `installDir` so `{{skills_dir}}` resolves to `.cursor/skills/`.
- Per-agent manifest is stored at `~/.nori/manifests/cursor-agent.json` via the shared manifest infrastructure in @/src/cli/features/manifest.ts.

### Core Implementation

The `cursorAgentConfig` declares its loader pipeline via `getLoaders()`:

1. `configLoader` -- shared config persistence, from @/src/cli/features/configLoader.ts
2. `skillsLoader` -- shared, from @/src/cli/features/shared/skillsLoader.ts
3. `createInstructionsLoader({ managedDirs: ["rules"] })` -- shared
4. `createSlashCommandsLoader({ managedDirs: ["commands"] })` -- shared
5. `createSubagentsLoader({ managedDirs: ["agents"] })` -- shared

Cursor-specific path mappings (all declared inline on the `AgentConfig` in `agent.ts`):

| Skillset Component | Claude Code Target | Cursor Target |
|---|---|---|
| `CLAUDE.md` (source) | `.claude/CLAUDE.md` | `.cursor/rules/AGENTS.md` |
| `skills/` | `.claude/skills/` | `.cursor/skills/` |
| `slashcommands/` | `.claude/commands/` | `.cursor/commands/` |
| `subagents/` | `.claude/agents/` | `.cursor/agents/` |

The key difference is `getInstructionsFilePath()` returns `.cursor/rules/AGENTS.md`, so the shared instructions loader writes to `AGENTS.md` inside a `rules/` subdirectory. The instructions loader is parameterized with `managedDirs: ["rules"]` so that directory is tracked by the manifest system.

### Things to Know

- **No optional AgentConfig properties**: The Cursor agent does not implement `getTranscriptDirectory` or `getArtifactPatterns`. This means the watch command and factory reset are not available for Cursor.
- **No agent-specific loaders**: Unlike Claude Code, Cursor has no hooks, statusline, announcements, or permissions loaders. All loaders are shared.
- **AGENTS.md lives inside `.cursor/rules/`**: The `createInstructionsLoader` is parameterized with `managedDirs: ["rules"]`, so `AGENTS.md` at `.cursor/rules/AGENTS.md` is tracked by the manifest system via the `rules/` directory.
- The skillset's `CLAUDE.md` is the source file (not `AGENTS.md`). The mapping to `AGENTS.md` happens at write time in the shared instructions loader, which uses `agent.getInstructionsFilePath()` to determine the destination path.
- Installation detection uses the `.nori-managed` marker file in `.cursor/` -- there is no backwards-compatible content-sniffing fallback like Claude Code has.

Created and maintained by Nori.
