# Noridoc: features

Path: @/src/cli/features

### Overview

The features directory contains the agent abstraction layer, shared loaders, and shared infrastructure for skillset installation. It defines the `AgentConfig` and `AgentLoader` types that allow the system to support multiple AI coding agents. Every supported agent (Claude Code, Codex, Cursor, Gemini CLI, and many more) is declared as one row in a single declarative table in `agentTable.ts` -- there are no per-agent implementation files. The only agent-specific subdirectory is `claude-code/`, which houses Claude-only loaders (hooks, statusline, announcements) referenced from its table row. The directory also includes the install orchestration (`install/`), MCP server config bundling (canonical schema authored in skillsets, translated per-agent at install time), and required-environment-variable surfacing.

### How it fits into the larger codebase

The `AgentRegistry` singleton is the central entry point used by CLI commands (e.g., `@/src/cli/commands/init`) to discover and interact with agent implementations. Each agent declares an ordered list of `AgentLoader` instances via `getLoaders()`, which `agentOperations.installSkillset()` executes sequentially to install configuration. CLI commands do not call agent methods directly for lifecycle operations (install, switch, remove, detect changes); instead they call shared functions from `agentOperations.ts` that accept an `AgentConfig` as a parameter.

```
CLI Commands (switch-skillset, init, config, ...) + install orchestration (install/)
    |
    +-- AgentRegistry.getInstance().get({ name }) --> AgentConfig
    +-- AgentRegistry.getInstance().getAll()      --> iterate all agents
    |
    +-- agentOperations.ts (shared functions, parameterized by AgentConfig)
    |       |
    |       +-- installSkillset({ agent, config })
    |       +-- switchSkillset({ agent, installDir, skillsetName })
    |       +-- removeSkillset({ agent, installDir })
    |       +-- detectLocalChanges({ agent, installDir })
    |       +-- getInstalledSkillsetName({ agent, path })
    |       +-- isInstalledAtDir({ agent, path })
    |       +-- markInstall({ agent, path, skillsetName })
    |       +-- detectExistingConfig({ agent, installDir })
    |       +-- captureExistingConfig({ agent, installDir, skillsetName, config })
    |       +-- findArtifacts({ agent, startDir, stopDir? })
    |       +-- getManagedFiles({ agent })  --> derived from loader declarations
    |       +-- getManagedDirs({ agent })   --> derived from loader declarations
    |
    +-- AgentConfig (built from AGENT_DEFINITIONS rows in agentTable.ts
    |       |        via buildAgentConfig)
    |       +-- name, displayName, description, supportTier, capabilities
    |       +-- getAgentDir({ installDir })
    |       +-- getSkillsDir({ installDir })
    |       +-- getSubagentsDir({ installDir })
    |       +-- getSlashcommandsDir({ installDir })
    |       +-- getInstructionsFilePath({ installDir })
    |       +-- getLoaders() --> Array<AgentLoader>
    |       +-- getLegacyManifestPath?()
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

The `--agent` global CLI option determines which agent implementation is used; the default is the explicit `DEFAULT_AGENT_NAME` constant in `agentTable.ts` (currently `claude-code`), not registration order. The active skillset is stored as `activeSkillset` in the Config type, shared across all agents.

### Core Implementation

**Agent Table** (agentTable.ts): The single declarative definition of every agent. Each agent is one `AgentDefinition` row; `buildAgentConfig` turns a row into the `AgentConfig` consumed by the registry and shared operations. All agent variance is data on the row rather than code: agent dir path segments (with an optional global-install override, e.g. Goose's `~/.config/goose/`), subagents/slashcommands dir names, instructions file name and placement, subagent target format, MCP binding, agent-specific extra loaders, external settings files, legacy manifest path, transcript directory, and artifact patterns. `buildAgentConfig` also derives each agent's `capabilities` (mcp/hooks/statusline/transcripts) from the row and derives the human-readable `description` string from those capabilities -- descriptions are never hand-maintained. This table replaced the former per-agent `<agent>/agent.ts` files, which were ~90% copy-paste of each other. Adding an agent means adding a row; agent-specific code (e.g. the claude-code loaders) is only ever referenced from the row itself.

**AgentConfig type** (agentRegistry.ts): Data-oriented agent configuration that replaced the former monolithic `Agent` interface. Built exclusively from `AgentDefinition` rows via `buildAgentConfig`. Each agent carries identity fields (`name`, `displayName`, `description`, `supportTier`, `capabilities`), path getters, a loader list, and optional legacy-manifest/transcript/artifact functions. All lifecycle operations (install, switch, remove, detect changes, etc.) are shared functions in `agentOperations.ts` parameterized by `AgentConfig`, rather than methods on each agent object.

**Shared Types** (agentRegistry.ts):

| Type | Purpose |
|------|---------|
| `AgentName` | Union type of canonical agent identifiers (e.g., `"claude-code"`, `"cline"`, `"cursor-agent"`, `"codex"`, `"gemini-cli"`, `"github-copilot"`, etc.). Registry key. |
| `AgentLoader` | Unified loader interface. Receives `{ agent, config, skillset }` via `run()` and declares `managedFiles`/`managedDirs` for manifest tracking. Optionally implements `uninstall({ agent, installDir })` for non-settings cleanup that lives outside the agent directory (e.g., deleting `~/.claude/nori-statusline.sh`). External settings files (like `~/.claude/settings.json`) are backed up/restored at the agent level via `getExternalSettingsFiles()` rather than per-loader key removal. All loaders (shared and agent-specific) implement this type directly. |
| `AgentConfig` | Data-oriented agent configuration. Declares identity/tier/capability fields, path functions, `getLoaders()`, optional `getExternalSettingsFiles()` (for agent-level backup/restore of external settings), optional `getLegacyManifestPath()` (pre-per-agent-manifest location), and optional `getTranscriptDirectory`/`getArtifactPatterns`. |
| `AgentSupportTier` | `"supported"` (well-tested end to end) vs `"experimental"` (best-effort). Surfaces in the config flow's agent picker (see @/src/cli/prompts/flows/config.ts). |
| `AgentCapabilities` | Booleans for mcp/hooks/statusline/transcripts, derived from the definition row. The `description` string is generated from these. |
| `ExistingConfig` | Describes detected unmanaged configuration. The `configFileName` field derives from `agent.getInstructionsFilePath()` so the init flow displays agent-appropriate strings. |
| `AgentArtifact` | Describes a discovered configuration artifact (path + type). Used by `findArtifacts` and factory reset. |

**AgentRegistry** (agentRegistry.ts):
- Singleton pattern. Constructor builds every agent from `AGENT_DEFINITIONS` via `buildAgentConfig` -- there is no per-agent import or registration step.
- `get({ name })`: Returns `AgentConfig`, throws if not found.
- `getAll()`: Returns all registered `AgentConfig` objects.
- `getDefaultAgentName()`: Returns `DEFAULT_AGENT_NAME` from agentTable.ts. Used as the fallback by `getDefaultAgents()` in @/src/cli/config.ts and for the `--agent` help text in @/src/cli/nori-skillsets.ts.
- `getAgentDirNames()`: Returns config directory basenames (e.g., `[".claude", ".cursor", ".codex", ...]`). Used by `normalizeInstallDir()` and `resolveInstallDir()` in @/src/utils/path.ts.

**Agent Operations** (agentOperations.ts): Shared functions that replace duplicated methods from the old `Agent` interface. Every function accepts an `AgentConfig` as its first parameter:
- `getManagedFiles/getManagedDirs`: Aggregates managed paths from all loaders' `managedFiles`/`managedDirs` declarations. This replaces hardcoded lists that were previously on each agent object.
- `getInstalledSkillsetName`: Reads the skillset name recorded in a directory's `.nori-managed` marker (null when no marker exists). This is the single read path for "what is installed for agent A at directory D" -- `isInstalledAtDir` and `findActiveSkillsets` in @/src/cli/commands/list-active/listActive.ts both derive from it rather than re-reading the marker themselves.
- `isInstalledAtDir`: True when `getInstalledSkillsetName` finds a marker, with a fallback to checking the agent's instructions file for `NORI-AI MANAGED BLOCK`.
- `markInstall`: Writes `.nori-managed` marker containing the skillset name.
- `installSkillset`: Parses the active skillset via `parseSkillset()`, backs up any external settings files declared by `agent.getExternalSettingsFiles()` via `backupSettingsFile()` from `@/src/cli/features/settingsBackup.ts` (idempotent; skips if backup already exists), runs all loaders from `agent.getLoaders()`, collects settings labels for a consolidated output note, writes the (agent, install dir) manifest (non-fatal on failure), emits a Skills note, and surfaces missing required environment variables via `checkRequiredEnv` from @/src/cli/features/envCheck.ts. It does **not** write `.nori-managed` markers; that responsibility belongs solely to `initMain` in @/src/cli/commands/init/init.ts, which calls `markInstall` for all default agents.
- `switchSkillset`: Validates the target skillset exists (has `nori.json`) and logs success. Does not persist config.
- `removeSkillset`: Runs `removeManagedFiles()` against the keyed (agent, install dir) manifest and both legacy manifest locations -- the old per-agent path from `getLegacyAgentManifestPath` and the agent-declared pre-manifest path when `getLegacyManifestPath` is present (declared as data on the claude-code table row -- shared code never branches on agent name). It then iterates over all loaders calling each loader's optional `uninstall()` method for non-settings cleanup, and restores external settings files from their pre-install backups via `restoreSettingsFile()` from `@/src/cli/features/settingsBackup.ts`. This full-file restore replaces the old approach of per-loader surgical key removal from settings files.
- `detectLocalChanges`: Returns null immediately when `isInstalledAtDir` is false -- a directory Nori never installed to has no local changes by definition, and this guard keeps legacy pre-keying manifests (which describe whichever directory was installed last) from producing phantom changes elsewhere. Otherwise reads the keyed manifest (falling back through the legacy paths above) and compares file hashes.
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
- Persists `activeSkillset`, auth credentials, and transcript settings via `updateConfig()`. It only sends auth fields that are actually present in the runtime config; absent credential fields are omitted rather than sent as nulls so the shared config merge can preserve existing broker-managed `idToken` credentials. The CLI version is not persisted — the running binary is the source of truth via `getCurrentPackageVersion()` in @/src/cli/version.ts.

**Settings Backup** (settingsBackup.ts): Provides `backupSettingsFile({ file })` and `restoreSettingsFile({ file })` for full-file backup/restore of external settings files (e.g., `~/.claude/settings.json`). Backup creates `<file>.pre-nori` alongside the original and is idempotent (will not overwrite an existing backup). Restore copies the backup over the current file and deletes the backup; if no backup exists, it deletes the settings file (meaning the file did not exist before Nori was installed). This is an agent-level concern: agents opt in by implementing `getExternalSettingsFiles()` on their `AgentConfig`, and `installSkillset`/`removeSkillset` in `agentOperations.ts` call backup/restore respectively.

**Install orchestration** (install/): The end-to-end install/reinstall pipeline (`main`/`noninteractive`/`completeInstallation`) plus the shared non-interactive init core (`ensureNoriInitialized`), install-state detection, and ASCII banners. Called by commands (`switch-skillset`, `config`, `registry-install`) and by the `init` command's non-interactive path. See @/src/cli/features/install/docs.md.

**Manifest module** (manifest.ts): File-level change tracking with SHA-256 hashes. Manifests are keyed per (agent, install directory): `getManifestPath` folds a hash of the resolved install dir into the file name (`~/.nori/manifests/<agent>/<dirKey>.json`), and each manifest records the `installDir` it describes, so activity in one directory never touches the manifest of another. This keying replaced a single global file per agent, whose shared state forced a `skipManifest` flag and marker-cleanup compensation in callers -- both now deleted. `readManifest` accepts an ordered `fallbackPaths` chain so pre-keying installs keep working; the two legacy locations are the old per-agent path (`getLegacyAgentManifestPath`, `~/.nori/manifests/<agent>.json`) and the agent-declared pre-manifest path (`getLegacyManifestPath`, `~/.nori/installed-manifest.json`, referenced from the claude-code table row). `removeManagedFiles` deletes the `.nori-managed` marker even when no manifest exists, so clearing multiple install dirs succeeds in any order.

**Other shared modules**: `template.ts` (placeholder substitution), `bundled-skillsets/` (bundled skills installer), `shared/managedDirOps.ts` (`resetManagedDir` helper used by the skills/slashcommands/subagents loaders to clear their destination directory before repopulating it while preserving any top-level dotfile entries).

**Managed vs unmanaged boundary**: Top-level entries whose names start with `.` inside an agent's managed dirs (e.g., `<agent>/skills/.system/`) are treated as external, agent-owned content. They are invisible to `compareManifest` (so they never appear in the `switch` flow's "Local Changes Detected" prompt) and are skipped by `resetManagedDir` (so they survive reinstalls). This keeps Nori's reach scoped to non-dotfile children of declared `managedDirs`. See `manifest.ts` (`collectFiles` skips dotfile entries at every recursion level) and `shared/managedDirOps.ts`.

Skillset path utilities (`getNoriDir`, `getNoriSkillsetsDir`), the `Skillset` type, `parseSkillset()`, and `listSkillsets()` now live in @/src/norijson/skillset.ts. Metadata CRUD functions (`readSkillsetMetadata`, `writeSkillsetMetadata`, `addSkillToNoriJson`, `ensureNoriJson`) now live in @/src/norijson/nori.ts.

### Things to Know

- The `AgentRegistry` builds all agents in its constructor from `AGENT_DEFINITIONS` in agentTable.ts. There is no separate registration step, loader registry class, or per-agent module to import. Adding a new agent is a single new row.
- Every agent gets the same shared loader pipeline (`configLoader`, `skillsLoader`, `createInstructionsLoader`, `createSlashCommandsLoader`, `createSubagentsLoader`), assembled by `buildAgentConfig`. An MCP loader is appended when the row declares an `mcp` binding (e.g., Claude Code, Codex, Cursor), and agent-specific `extraLoaders` are appended last -- only Claude Code declares any (hooks, statusline, announcements, living in @/src/cli/features/claude-code/).
- Each agent maps to its own dot-directory convention and instructions file name, declared as `agentDirSegments` / `instructionsFileName` on its definition row. Most agents use `AGENTS.md`; notable exceptions include Claude Code (`CLAUDE.md`), Gemini CLI (`GEMINI.md`), and GitHub Copilot (`copilot-instructions.md`, with `prompts/` instead of `commands/` for slash commands).
- Instructions file placement is driven by the row's `instructionsPlacement`: `"agent-dir"` (default, file at the agent dir root -> `managedFiles`), `"rules-subdir"` (file at `rules/AGENTS.md` inside the agent dir -> `managedDirs: ["rules"]`; used by Cursor, Cline, Kilo), or `"install-root-for-project"` (file at the install root for project installs, inside the agent dir for global installs; used by Codex, Goose, OpenCode).
- Agents have a `supportTier`: `"supported"` agents are well-tested end to end, `"experimental"` agents are best-effort. The tier flows through `onResolveAgents` into the config flow's agent picker, which lists supported agents first and appends "(experimental)" to experimental agents' hints (see @/src/cli/prompts/flows/config.ts).
- Shared code never special-cases agent names. Agent quirks (e.g., claude-code's legacy manifest location, external settings files) are declared as data on the definition row and read via optional `AgentConfig` accessors in @/src/cli/features/agentOperations.ts.
- Install-state invariants: each "is this installed / what changed" question has exactly one code path (`getInstalledSkillsetName` for markers, `detectLocalChanges` over keyed manifests for file hashes); manifests are scoped per (agent, install directory) so no directory's activity can falsify another's state; and clears succeed in any order because `removeManagedFiles` drops the marker even without a manifest.
- `getManagedFiles()` and `getManagedDirs()` are now derived from the union of all loader declarations rather than being hardcoded on each agent. This means adding a new loader with `managedFiles` or `managedDirs` automatically updates the manifest tracking scope.
- Dotfile children of managed dirs are external. The skills, slashcommands, and subagents loaders all clear their destination via `resetManagedDir` from `shared/managedDirOps.ts` rather than `fs.rm`-ing the whole dir, so an agent's own state (e.g. Codex's `~/.codex/skills/.system/`) survives a reinstall. The same dotfile filter in `manifest.ts` keeps those entries out of the manifest diff so they do not surface in the `switch` flow's local-changes prompt (see @/src/cli/prompts/flows/switchSkillset.ts).
- All loaders (shared and agent-specific) implement the `AgentLoader` interface directly. There is no legacy adapter layer; every loader exports an `AgentLoader` object with `name`, `description`, `managedFiles`/`managedDirs`, a `run` function, and an optional `uninstall` function. Loader `uninstall` is now only needed for non-settings cleanup (e.g., deleting `~/.claude/nori-statusline.sh`). External settings files (e.g., `~/.claude/settings.json`) are backed up before loaders run and restored in full on uninstall, via the agent-level `getExternalSettingsFiles()` mechanism in `@/src/cli/features/settingsBackup.ts`. This replaced the previous approach where each loader individually removed its keys with `removeSettingsKeys()` — that function no longer exists.
- `parseSkillset` checks for `AGENTS.md` first, then falls back to `CLAUDE.md` for backward compatibility. New skillsets are created with `AGENTS.md`. The mapping from the skillset's config file to each agent's native instructions file format happens at write time in the instructions loader. `parseSkillset` lives in @/src/norijson/skillset.ts.
- The MCP loader is the only loader that can write to two locations in a single run: a project-scope file under `installDir` (e.g., `<installDir>/.mcp.json`) and a user-scope file under home (e.g., `~/.claude.json`). Each canonical server's `scope` field selects which bucket it lands in (default project). Codex specifically writes its project file to `<installDir>/.codex/config.toml` (Option B) — the user must mark the project trusted for Codex to load it.
- Required environment variables surface at the end of `installSkillset`: a skillset's `nori.json` may declare a `requiredEnv` array (strings or objects with `name`/`description`/`url`); `checkRequiredEnv` in @/src/cli/features/envCheck.ts reads `process.env` and returns missing names. `installSkillset` displays them in a clack `note` titled "Missing environment variables" so the user can export them before launching the agent.

Created and maintained by Nori.
