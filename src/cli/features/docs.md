# Noridoc: features

Path: @/src/cli/features

### Overview

The features directory contains the agent abstraction layer, shared loaders, and all agent-specific feature implementations. It defines the `AgentConfig` and `AgentLoader` types that allow the system to support multiple AI coding agents, and houses agent implementations (Claude Code and Cursor) along with shared infrastructure for skillset installation.

### How it fits into the larger codebase

The `AgentRegistry` singleton is the central entry point used by CLI commands (e.g., `@/src/cli/commands/init`) to discover and interact with agent implementations. Each agent declares an ordered list of `AgentLoader` instances via `getLoaders()`, which `agentOperations.installSkillset()` executes sequentially to install configuration. CLI commands do not call agent methods directly for lifecycle operations (install, switch, remove, detect changes); instead they call shared functions from `agentOperations.ts` that accept an `AgentConfig` as a parameter.

```
CLI Commands (install, switch-skillset, init, config, factory-reset, clear)
    |
    +-- AgentRegistry.getInstance().get({ name }) --> AgentConfig
    +-- AgentRegistry.getInstance().getAll()      --> iterate all agents
    |
    +-- agentOperations.ts (shared functions, parameterized by AgentConfig)
    |       |
    |       +-- installSkillset({ agent, config, skipManifest? })
    |       +-- switchSkillset({ agent, installDir, skillsetName })
    |       +-- removeSkillset({ agent, installDir })
    |       +-- detectLocalChanges({ agent, installDir })
    |       +-- isInstalledAtDir({ agent, path })
    |       +-- markInstall({ agent, path, skillsetName })
    |       +-- detectExistingConfig({ agent, installDir })
    |       +-- captureExistingConfig({ agent, installDir, skillsetName, config })
    |       +-- findArtifacts({ agent, startDir, stopDir? })
    |       +-- getManagedFiles({ agent })  --> derived from loader declarations
    |       +-- getManagedDirs({ agent })   --> derived from loader declarations
    |
    +-- AgentConfig (data-oriented, declared in each agent's agent.ts)
    |       |
    |       +-- getAgentDir({ installDir })
    |       +-- getSkillsDir({ installDir })
    |       +-- getSubagentsDir({ installDir })
    |       +-- getSlashcommandsDir({ installDir })
    |       +-- getInstructionsFilePath({ installDir })
    |       +-- getLoaders() --> Array<AgentLoader>
    |       +-- getTranscriptDirectory?()
    |       +-- getArtifactPatterns?()
    |
    +-- shared/ (agent-agnostic loaders used by both agents)
    |       |
    |       +-- skillsLoader, createInstructionsLoader,
    |       +-- createSlashCommandsLoader, createSubagentsLoader
    |
    +-- listProfiles() --> Available skillset names (from managedFolder.ts)
```

The `--agent` global CLI option (default: "claude-code") determines which agent implementation is used. The active skillset is stored as `activeSkillset` in the Config type, shared across all agents.

### Core Implementation

**AgentConfig type** (agentRegistry.ts): Data-oriented agent configuration that replaced the former monolithic `Agent` interface. Each agent declares path getters, a loader list, and optional transcript/artifact pattern functions. All lifecycle operations (install, switch, remove, detect changes, etc.) are shared functions in `agentOperations.ts` parameterized by `AgentConfig`, rather than methods on each agent object.

**Shared Types** (agentRegistry.ts):

| Type | Purpose |
|------|---------|
| `AgentName` | Union type of canonical agent identifiers (`"claude-code" \| "cursor-agent"`). Registry key. |
| `Loader` | Legacy interface for agent-specific loaders (hooks, statusline, announcements). Wrapped via `wrapLegacyLoader()` into `AgentLoader`. |
| `AgentLoader` | Unified loader interface. Receives `{ agent, config, skillset }` and declares `managedFiles`/`managedDirs` for manifest tracking. |
| `AgentConfig` | Data-oriented agent configuration. Declares path functions, `getLoaders()`, and optional `getTranscriptDirectory`/`getArtifactPatterns`. |
| `ExistingConfig` | Describes detected unmanaged configuration. The `configFileName` field derives from `agent.getInstructionsFilePath()` so the init flow displays agent-appropriate strings. |
| `AgentArtifact` | Describes a discovered configuration artifact (path + type). Used by `findArtifacts` and factory reset. |

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern. Constructor registers `claudeCodeAgentConfig` and `cursorAgentConfig` directly (imported from their agent modules).
- `get({ name })`: Returns `AgentConfig`, throws if not found.
- `getAll()`: Returns all registered `AgentConfig` objects.
- `getAgentDirNames()`: Returns config directory basenames (e.g., `[".claude", ".cursor"]`). Used by `normalizeInstallDir()` and `resolveInstallDir()` in @/src/utils/path.ts.

**Agent Operations** (agentOperations.ts): Shared functions that replace duplicated methods from the old `Agent` interface. Every function accepts an `AgentConfig` as its first parameter:
- `getManagedFiles/getManagedDirs`: Aggregates managed paths from all loaders' `managedFiles`/`managedDirs` declarations. This replaces hardcoded lists that were previously on each agent object.
- `isInstalledAtDir`: Checks for `.nori-managed` marker file, then falls back to checking the agent's instructions file for `NORI-AI MANAGED BLOCK`.
- `markInstall`: Writes `.nori-managed` marker containing the skillset name.
- `installSkillset`: Parses the active skillset via `parseSkillset()`, runs all loaders from `agent.getLoaders()`, collects settings labels for a consolidated output note, optionally writes the manifest, and emits a Skills note. It does **not** write `.nori-managed` markers; that responsibility belongs solely to `initMain` in @/src/cli/commands/init/init.ts, which calls `markInstall` for all default agents.
- `switchSkillset`: Validates the target skillset exists (has `nori.json`) and logs success. Does not persist config.
- `removeSkillset`: Reads per-agent manifest, calls `removeManagedFiles()`. Includes legacy manifest cleanup for claude-code.
- `detectLocalChanges`: Reads per-agent manifest (with legacy fallback for claude-code), compares file hashes.
- `detectExistingConfig`: Scans the agent directory for instructions file, skills, subagents, and slashcommands using the agent's path getters.
- `captureExistingConfig`: Captures existing config as a named skillset, deletes the original instructions file, then runs the instructions loader to restore a managed block.
- `findArtifacts`: Walks the ancestor directory tree checking for patterns declared by `agent.getArtifactPatterns()`.

**Shared Loaders** (shared/): Agent-agnostic loaders that replaced duplicated per-agent implementations. Each loader uses `AgentConfig` path getters to resolve source and destination paths:
- `skillsLoader` (shared/skillsLoader.ts): Copies skills from skillset to agent's skills directory with template substitution on `.md` files, then calls `copyBundledSkills()`.
- `createInstructionsLoader` (shared/instructionsLoader.ts): Factory function. Reads the skillset's `CLAUDE.md`, strips existing managed block markers, applies template substitution, generates a skills list section (scanning SKILL.md front matter), and writes/replaces the managed block in the agent's instructions file. Parameterized by `managedFiles`/`managedDirs` so Claude Code passes `managedFiles: ["CLAUDE.md"]` while Cursor passes `managedDirs: ["rules"]`.
- `createSlashCommandsLoader` (shared/slashCommandsLoader.ts): Factory function. Copies `.md` files from skillset's slashcommands dir, applies template substitution, emits a "Slash Commands" note.
- `createSubagentsLoader` (shared/subagentsLoader.ts): Factory function. Copies `.md` files from skillset's subagents dir, applies template substitution, emits a "Subagents" note.

**Config Loader** (config/loader.ts):
- Shared `Loader` (legacy interface) that manages `.nori-config.json`. All agents MUST include this loader (wrapped via `wrapLegacyLoader`).
- Persists `activeSkillset`, version, auth credentials, and transcript settings via `updateConfig()`.

**Skillset Parser** (skillset.ts):
- `parseSkillset({ skillsetName?, skillsetDir? })`: Resolves a skillset directory, calls `ensureNoriJson()`, reads metadata, probes for optional subdirectories/files. The `configFileName` is hardcoded to `"CLAUDE.md"` internally -- all agents read from the same skillset source file. Each agent's instructions loader handles mapping to the agent-specific destination (e.g., Cursor writes to `AGENTS.md`).

**Managed Folder Utilities** (managedFolder.ts):
- `listProfiles()`: Scans `~/.nori/profiles/` for directories containing `nori.json`, supporting flat and namespaced layouts. Calls `ensureNoriJson()` for backwards compatibility.
- Imported directly by CLI commands rather than going through the agent layer.

**Other shared modules**: `paths.ts` (Nori directory paths), `template.ts` (placeholder substitution), `skillsetMetadata.ts` (nori.json CRUD), `manifest.ts` (file-level change tracking with SHA-256 hashes), `migration.ts` (versioned config migrations), `bundled-skillsets/` (bundled skills installer).

### Things to Know

- The `AgentRegistry` registers both agents in its constructor by importing their config objects directly. There is no separate registration step or loader registry class.
- `getManagedFiles()` and `getManagedDirs()` are now derived from the union of all loader declarations rather than being hardcoded on each agent. This means adding a new loader with `managedFiles` or `managedDirs` automatically updates the manifest tracking scope.
- The `wrapLegacyLoader()` function in each agent's `agent.ts` adapts `Loader` (legacy, `{ config }` signature) to `AgentLoader` (`{ agent, config, skillset }` signature). This is used for agent-specific loaders that have not yet been migrated to the shared `AgentLoader` pattern (hooks, statusline, announcements for Claude Code; configLoader for both agents).
- `parseSkillset` no longer accepts a `configFileName` parameter. It hardcodes `"CLAUDE.md"` because all skillsets use `CLAUDE.md` as the source file. The mapping to each agent's native format happens at write time in the instructions loader.

Created and maintained by Nori.
