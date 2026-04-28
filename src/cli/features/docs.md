# Noridoc: features

Path: @/src/cli/features

### Overview

The features directory contains the agent abstraction layer, shared loaders, and all agent-specific feature implementations. It defines the `AgentConfig` and `AgentLoader` types that allow the system to support multiple AI coding agents, and houses agent implementations for Claude Code, Cursor, and many other agents (Codex, Droid, Gemini CLI, GitHub Copilot, Goose, Kilo, Kimi CLI, OpenCode, OpenClaw, Pi) along with shared infrastructure for skillset installation. It also includes MCP server config bundling (canonical schema authored in skillsets, translated per-agent at install time) and required-environment-variable surfacing.

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
    +-- shared/ (agent-agnostic loaders used by all agents)
    |       |
    |       +-- skillsLoader, createInstructionsLoader,
    |       +-- createSlashCommandsLoader, createSubagentsLoader,
    |       +-- createMcpLoader (factory; per-agent format binding)
    |
    +-- listSkillsets() --> Available skillset names (from @/norijson/skillset.ts)
```

The `--agent` global CLI option (default: "claude-code") determines which agent implementation is used. The active skillset is stored as `activeSkillset` in the Config type, shared across all agents.

### Core Implementation

**AgentConfig type** (agentRegistry.ts): Data-oriented agent configuration that replaced the former monolithic `Agent` interface. Each agent declares path getters, a loader list, and optional transcript/artifact pattern functions. All lifecycle operations (install, switch, remove, detect changes, etc.) are shared functions in `agentOperations.ts` parameterized by `AgentConfig`, rather than methods on each agent object.

**Shared Types** (agentRegistry.ts):

| Type | Purpose |
|------|---------|
| `AgentName` | Union type of canonical agent identifiers (e.g., `"claude-code"`, `"cursor-agent"`, `"codex"`, `"gemini-cli"`, `"github-copilot"`, etc.). Registry key. |
| `AgentLoader` | Unified loader interface. Receives `{ agent, config, skillset }` and declares `managedFiles`/`managedDirs` for manifest tracking. All loaders (shared and agent-specific) implement this type directly. |
| `AgentConfig` | Data-oriented agent configuration. Declares path functions, `getLoaders()`, and optional `getTranscriptDirectory`/`getArtifactPatterns`. |
| `ExistingConfig` | Describes detected unmanaged configuration. The `configFileName` field derives from `agent.getInstructionsFilePath()` so the init flow displays agent-appropriate strings. |
| `AgentArtifact` | Describes a discovered configuration artifact (path + type). Used by `findArtifacts` and factory reset. |

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern. Constructor registers all agent configs directly (imported from their respective agent modules).
- `get({ name })`: Returns `AgentConfig`, throws if not found.
- `getAll()`: Returns all registered `AgentConfig` objects.
- `getAgentDirNames()`: Returns config directory basenames (e.g., `[".claude", ".cursor", ".codex", ".gemini", ...]`). Used by `normalizeInstallDir()` and `resolveInstallDir()` in @/src/utils/path.ts.

**Agent Operations** (agentOperations.ts): Shared functions that replace duplicated methods from the old `Agent` interface. Every function accepts an `AgentConfig` as its first parameter:
- `getManagedFiles/getManagedDirs`: Aggregates managed paths from all loaders' `managedFiles`/`managedDirs` declarations. This replaces hardcoded lists that were previously on each agent object.
- `isInstalledAtDir`: Checks for `.nori-managed` marker file, then falls back to checking the agent's instructions file for `NORI-AI MANAGED BLOCK`.
- `markInstall`: Writes `.nori-managed` marker containing the skillset name.
- `installSkillset`: Parses the active skillset via `parseSkillset()`, runs all loaders from `agent.getLoaders()`, collects settings labels for a consolidated output note, optionally writes the manifest, emits a Skills note, and surfaces missing required environment variables via `checkRequiredEnv` from @/src/cli/features/envCheck.ts. It does **not** write `.nori-managed` markers; that responsibility belongs solely to `initMain` in @/src/cli/commands/init/init.ts, which calls `markInstall` for all default agents.
- `switchSkillset`: Validates the target skillset exists (has `nori.json`) and logs success. Does not persist config.
- `removeSkillset`: Reads per-agent manifest, calls `removeManagedFiles()`. Includes legacy manifest cleanup for claude-code.
- `detectLocalChanges`: Reads per-agent manifest (with legacy fallback for claude-code), compares file hashes.
- `detectExistingConfig`: Scans the agent directory for instructions file, skills, subagents, and slashcommands using the agent's path getters.
- `captureExistingConfig`: Captures existing config as a named skillset (writing `AGENTS.md` as the config file), deletes the original instructions file, then runs the instructions loader to restore a managed block. When copying subagents back from the installed flat files, it checks whether a directory-based subagent already exists in the skillset's `subagents/` directory; if so, it updates the existing `SUBAGENT.md` instead of creating a duplicate flat file.
- `findArtifacts`: Walks the ancestor directory tree checking for patterns declared by `agent.getArtifactPatterns()`.

**Shared Loaders** (shared/): Agent-agnostic loaders that replaced duplicated per-agent implementations. Each loader uses `AgentConfig` path getters to resolve source and destination paths:
- `skillsLoader` (shared/skillsLoader.ts): Copies skills from skillset to agent's skills directory with template substitution on `.md` files, then calls `copyBundledSkills()`.
- `createInstructionsLoader` (shared/instructionsLoader.ts): Factory function. Reads the skillset's config file (`AGENTS.md` or `CLAUDE.md`, as resolved by `parseSkillset`), strips existing managed block markers, applies template substitution, generates a skills list section (scanning SKILL.md front matter), and writes/replaces the managed block in the agent's instructions file. Parameterized by `managedFiles`/`managedDirs` so Claude Code passes `managedFiles: ["CLAUDE.md"]` while Cursor passes `managedDirs: ["rules"]`.
- `createSlashCommandsLoader` (shared/slashCommandsLoader.ts): Factory function. Copies `.md` files from skillset's slashcommands dir, applies template substitution, emits a "Slash Commands" note.
- `createSubagentsLoader` (shared/subagentsLoader.ts): Factory function. Handles both flat files and directory-based subagents from the skillset's subagents dir. The default `targetFormat: "markdown"` path preserves the legacy behavior for markdown-native agents. `targetFormat: "codex-toml"` and `targetFormat: "pi-markdown"` switch to a shared resolver/emitter that can merge same-name `.md` + `.toml` flat files, prefer markdown body content as the authored prompt, treat TOML as runtime override metadata, and emit target-specific install artifacts. That flat-file `.md` + `.toml` fallback is temporary backwards compatibility for legacy skillsets and is scheduled for removal in `v0.1.0`. Directory-based subagents (those containing `SUBAGENT.md`) remain single-source and are still flattened to a single installed file. On name collisions between a flat file and a directory, the directory-based subagent takes precedence and any same-name flat files are skipped. Directories without `SUBAGENT.md` are silently ignored. All emitted content gets template substitution applied, and top-level `docs.md` / `docs.toml` files are excluded.
- `emitSubagentContent` (shared/subagentEmitter.ts): Shared resolver/emitter for Codex and Pi subagents. Parses markdown frontmatter (`name`, `description`, `tools`, `model`) and the narrow TOML runtime fields currently used by Nori (`name`, `description`, `sandbox_mode`, `model`, `model_reasoning_effort`, `developer_instructions`). Codex emission always writes `.toml`; Pi emission always writes markdown wrappers compatible with `pi-subagents-minimal`, including TOML-only fallback generation from `developer_instructions`.
- `createMcpLoader` (shared/mcpLoader.ts): Factory function. Reads canonical MCP server JSON files from `skillset.mcpDir`, filters by `worksWith`, splits by `scope` (project vs user), and writes per-agent files at the destination path returned by `projectFile({ installDir })` / `userFile()`. Supports three merge strategies (`whole-file`, `merge-mcp-servers-key`, `merge-toml-table`) so it can replace an entire MCP file (Claude Code project `.mcp.json`, Cursor `mcp.json`), graft into a JSON settings file under the relevant root key (Gemini `settings.json` `mcpServers`, VS Code `servers`, Zed `context_servers`), or splice TOML tables (Codex `config.toml`). Each agent's MCP wiring lives on its `AgentConfig.getLoaders()` so format-specific quirks stay with the agent.
- `emitMcpServers` / `parseAgentConfig` (shared/mcpEmitter.ts): Canonical MCP server schema and the JSON/TOML conversion in both directions. Authors write `${env:VAR}` placeholders; emit rewrites them into each agent's expected interpolation form (Claude/Gemini `${VAR}`, Cursor/VSCode/Zed passthrough, Codex strips placeholders entirely because Codex has no string interpolation). OAuth-typed servers emit no `Authorization` header — the agent runs the OAuth flow on first connect. The parser is the inverse used by `import-mcp` (see @/src/cli/commands/import-mcp/docs.md).

**Config Loader** (configLoader.ts):
- Shared `AgentLoader` that manages `.nori-config.json`. All agents include this loader in their `getLoaders()` pipeline.
- Persists `activeSkillset`, auth credentials, and transcript settings via `updateConfig()`. The CLI version is not persisted — the running binary is the source of truth via `getCurrentPackageVersion()` in @/src/cli/version.ts.

**Other shared modules**: `template.ts` (placeholder substitution), `manifest.ts` (file-level change tracking with SHA-256 hashes), `bundled-skillsets/` (bundled skills installer), `shared/managedDirOps.ts` (`resetManagedDir` helper used by the skills/slashcommands/subagents loaders to clear their destination directory before repopulating it while preserving any top-level dotfile entries).

**Managed vs unmanaged boundary**: Top-level entries whose names start with `.` inside an agent's managed dirs (e.g., `<agent>/skills/.system/`) are treated as external, agent-owned content. They are invisible to `compareManifest` (so they never appear in the `switch` flow's "Local Changes Detected" prompt) and are skipped by `resetManagedDir` (so they survive reinstalls). This keeps Nori's reach scoped to non-dotfile children of declared `managedDirs`. See `manifest.ts` (`collectFiles` skips dotfile entries at every recursion level) and `shared/managedDirOps.ts`.

Skillset path utilities (`getNoriDir`, `getNoriSkillsetsDir`), the `Skillset` type, `parseSkillset()`, and `listSkillsets()` now live in @/src/norijson/skillset.ts. Metadata CRUD functions (`readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `ensureNoriJson`) now live in @/src/norijson/nori.ts.

### Things to Know

- The `AgentRegistry` registers all agents in its constructor by importing their config objects directly. There is no separate registration step or loader registry class.
- Most agents follow an identical pattern: they use only the shared loaders (`configLoader`, `skillsLoader`, `createInstructionsLoader`, `createSlashCommandsLoader`, `createSubagentsLoader`, and optionally `createMcpLoader`). Only Claude Code has agent-specific loaders (hooks, statusline, announcements) and optional methods (`getTranscriptDirectory`, `getArtifactPatterns`). Agents that ship MCP support (Claude Code, Codex, Cursor, Gemini CLI) call `createMcpLoader` with their format binding.
- Each agent maps to its own dot-directory convention and instructions file name. Most agents use `AGENTS.md` as their instructions file. Notable exceptions: Claude Code uses `CLAUDE.md`, Gemini CLI uses `GEMINI.md`, GitHub Copilot uses `copilot-instructions.md`, and Cursor places its instructions at `rules/AGENTS.md`. GitHub Copilot also uses `prompts/` instead of `commands/` for its slash commands directory.
- The instructions loader factory (`createInstructionsLoader`) is parameterized differently depending on whether the instructions file lives at the root of the agent dir (`managedFiles: ["AGENTS.md"]`) vs. in a subdirectory (`managedDirs: ["rules"]` for Cursor).
- `getManagedFiles()` and `getManagedDirs()` are now derived from the union of all loader declarations rather than being hardcoded on each agent. This means adding a new loader with `managedFiles` or `managedDirs` automatically updates the manifest tracking scope.
- Dotfile children of managed dirs are external. The skills, slashcommands, and subagents loaders all clear their destination via `resetManagedDir` from `shared/managedDirOps.ts` rather than `fs.rm`-ing the whole dir, so an agent's own state (e.g. Codex's `~/.codex/skills/.system/`) survives a reinstall. The same dotfile filter in `manifest.ts` keeps those entries out of the manifest diff so they do not surface in the `switch` flow's local-changes prompt (see @/src/cli/prompts/flows/switchSkillset.ts).
- All loaders (shared and agent-specific) implement the `AgentLoader` interface directly. There is no legacy adapter layer; every loader exports an `AgentLoader` object with `name`, `description`, `managedFiles`/`managedDirs`, and a `run` function.
- `parseSkillset` checks for `AGENTS.md` first, then falls back to `CLAUDE.md` for backward compatibility. New skillsets are created with `AGENTS.md`. The mapping from the skillset's config file to each agent's native instructions file format happens at write time in the instructions loader. `parseSkillset` lives in @/src/norijson/skillset.ts.
- The MCP loader is the only loader that can write to two locations in a single run: a project-scope file under `installDir` (e.g., `<installDir>/.mcp.json`) and a user-scope file under home (e.g., `~/.claude.json`). Each canonical server's `scope` field selects which bucket it lands in (default project). Codex specifically writes its project file to `<installDir>/.codex/config.toml` (Option B) — the user must mark the project trusted for Codex to load it.
- Required environment variables surface at the end of `installSkillset`: a skillset's `nori.json` may declare a `requiredEnv` array (strings or objects with `name`/`description`/`url`); `checkRequiredEnv` in @/src/cli/features/envCheck.ts reads `process.env` and returns missing names. `installSkillset` displays them in a clack `note` titled "Missing environment variables" so the user can export them before launching the agent.

Created and maintained by Nori.
