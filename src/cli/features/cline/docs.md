# Noridoc: cline

Path: @/src/cli/features/cline

### Overview

- Cline agent implementation. Contains the `AgentConfig` declaration for the Cline VS Code extension.
- All path computations are inline in the `AgentConfig` in `agent.ts`. Uses only shared loaders from @/src/cli/features/shared/ -- no agent-specific loaders.

### How it fits into the larger codebase

- `agent.ts` exports `clineAgentConfig` (implements `AgentConfig`), imported directly by the `AgentRegistry` constructor in @/src/cli/features/agentRegistry.ts. CLI commands interact with this agent through shared operations in @/src/cli/features/agentOperations.ts.
- All agents share the same `activeSkillset` in the Config -- switching skillsets applies to all agents.
- Shared loaders read from `~/.nori/profiles/` using `parseSkillset()` from @/src/norijson/skillset.ts. The instructions loader writes resolved content to `.cline/rules/AGENTS.md` via `agent.getInstructionsFilePath()`.
- Per-agent manifest is stored at `~/.nori/manifests/cline.json` via the shared manifest infrastructure in @/src/cli/features/manifest.ts.

### Core Implementation

The `clineAgentConfig` declares its loader pipeline via `getLoaders()`:

1. `configLoader` -- shared config persistence, from @/src/cli/features/configLoader.ts
2. `skillsLoader` -- shared, from @/src/cli/features/shared/skillsLoader.ts
3. `createInstructionsLoader({ managedDirs: ["rules"] })` -- shared
4. `createSlashCommandsLoader({ managedDirs: ["commands"] })` -- shared
5. `createSubagentsLoader({ managedDirs: ["agents"] })` -- shared

Cline uses a single `.cline/` directory for both global (`~/.cline/`) and project-level (`.cline/`) config, unlike Goose which has different directories for global vs project installs.

| Skillset Component | Cline Target |
|---|---|
| `AGENTS.md` (source) | `.cline/rules/AGENTS.md` |
| `skills/` | `.cline/skills/` |
| `slashcommands/` | `.cline/commands/` |
| `subagents/` | `.cline/agents/` |

### Things to Know

- **No MCP loader**: Cline does not currently include a `createMcpLoader` in its loader pipeline. MCP server configuration for Cline is not managed by skillsets.
- **`managedDirs: ["rules"]` for instructions**: Cline's instructions file lives in a `rules/` subdirectory, matching the Cursor and Kilo pattern. The instructions loader tracks the entire `rules/` directory for manifest change detection.
- **No optional AgentConfig properties**: Cline does not implement `getTranscriptDirectory` or `getArtifactPatterns`, so the watch command and factory reset artifact scanning are not available for Cline.
- Installation detection uses the `.nori-managed` marker file in `.cline/` -- no backwards-compatible content-sniffing fallback.

Created and maintained by Nori.
