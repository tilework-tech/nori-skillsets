# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

The Claude Code agent implementation. This directory contains the `Agent` interface implementation for Claude Code, along with Claude-Code-specific path utilities, config capture, factory reset, and the `LoaderRegistry` that orchestrates feature installation. Agent-agnostic utilities (Nori directory paths, template substitution, skillset metadata) have been extracted to @/src/cli/features/.

### How it fits into the larger codebase

`agent.ts` exports `claudeCodeAgent`, which is registered in `@/src/cli/features/agentRegistry.ts` as the sole agent implementation. The `LoaderRegistry` in `loaderRegistry.ts` defines the ordered pipeline of feature loaders that run during `nori-skillsets install`: config -> profiles -> hooks -> statusline -> announcements. CLI commands like init, watch, and switch interact with this agent through the `Agent` interface for install detection (`isInstalledAtDir`), skillset switching (`switchSkillset`), and factory reset.

The `claudeCodeAgent` object in agent.ts provides:
- `name`: "claude-code"
- `displayName`: "Claude Code"
- `getAgentDir({ installDir })`: Returns `{installDir}/.claude` -- the Claude Code config directory path. Implements the `Agent` interface method from @/src/cli/features/agentRegistry.ts.
- The module-level `CONFIG_FILE_NAME` constant (`"CLAUDE.md"`) defines the root config filename for Claude Code. It is passed to `parseSkillset()` as `configFileName` so the parser resolves the correct config file. This constant is internal to the agent module and not exposed on the `Agent` interface.
- `getSkillsDir({ installDir })`: Returns `{installDir}/.claude/skills` -- the Claude Code skills directory path.
- `getProjectsDir()`: Returns `~/.claude/projects` -- the directory where Claude Code stores per-project session data. Used by the watch command to locate transcript files.
- `findArtifacts({ startDir, stopDir? })`: Delegates to `findClaudeCodeArtifacts` from factoryReset.ts. Walks the ancestor directory tree from `startDir` to discover `.claude/` directories and `CLAUDE.md` files. Used by factory reset to enumerate what will be deleted.
- `getManagedFiles()`: Returns `["CLAUDE.md", "settings.json", "nori-statusline.sh"]` -- the root-level files within `~/.claude/` that this agent installs and tracks
- `getManagedDirs()`: Returns `["skills", "commands", "agents"]` -- the directories within `~/.claude/` whose contents this agent installs and tracks recursively
- `getLoaderRegistry()`: Returns the LoaderRegistry singleton with all Claude Code loaders
- `switchSkillset({ installDir, skillsetName })`: Validates skillset exists (handles both flat and namespaced paths via `path.join`), updates config with new skillset, logs success message. The `installDir` argument is accepted (required by the `Agent` interface) but is treated as a per-invocation override -- it is not persisted to `~/.nori-config.json`. Instead, the method reads the existing config's `installDir` (defaulting to home dir) and preserves that value when saving. Imports `MANIFEST_FILE` from @/src/cli/features/managedFolder.ts to identify valid skillsets.
- `factoryReset({ path })`: Delegates to `factoryResetClaudeCode` from @/src/cli/features/claude-code/factoryReset.ts. Discovers and removes all `.claude` directories and `CLAUDE.md` files by walking up the ancestor directory tree from the given path.
- `isInstalledAtDir({ path })`: Checks for `.claude/.nori-managed` marker file first (new style), then falls back to checking `.claude/CLAUDE.md` for the "NORI-AI MANAGED BLOCK" string (backwards compatibility). Uses synchronous fs operations.
- `markInstall({ path, skillsetName })`: Creates `.claude/` directory if needed and writes `.claude/.nori-managed` containing the skillset name (or empty string if none). This marker file is the canonical per-directory installation indicator for the claude-code agent.
- `detectExistingConfig({ installDir })`: Delegates to `detectExistingConfig()` from @/src/cli/commands/install/existingConfigCapture.ts. Scans the install directory for unmanaged Claude Code configuration (CLAUDE.md, skills, agents, commands) and returns an `ExistingConfig` object with discovery results, including `configFileName: "CLAUDE.md"` so the init flow can display agent-appropriate strings.
- `captureExistingConfig({ installDir, skillsetName, config })`: Coordinates the three-step capture process: (1) calls `captureExistingConfigAsSkillset()` from existingConfigCapture.ts to copy existing config into a named skillset directory, (2) deletes the original CLAUDE.md to prevent content duplication, (3) calls `claudeMdLoader.install()` to restore a working managed CLAUDE.md block so the user isn't left without config.
- `detectLocalChanges({ installDir })`: Reads the per-agent manifest from `~/.nori/manifests/claude-code.json` (with legacy fallback to `~/.nori/installed-manifest.json`), compares file hashes in `{installDir}/.claude/` against stored hashes, and returns a `ManifestDiff` if changes exist or null otherwise. Encapsulates the manifest path resolution and legacy fallback logic that was previously inlined in the switch-skillset command.
- `removeSkillset({ installDir })`: Removes all Nori-managed files from `{installDir}/.claude/` by reading the per-agent manifest and calling `removeManagedFiles()` with explicit `managedDirs` from `getManagedDirs()`. Also cleans up files tracked under the legacy manifest path. Encapsulates the cleanup logic that was previously assembled inline in the config command.
- `installSkillset({ config })`: Runs all feature loaders from the `LoaderRegistry`, collects string labels returned by loaders to emit a consolidated "Settings" `note()` via `@clack/prompts`, computes and writes an installation manifest to `~/.nori/manifests/claude-code.json`, emits a "Skills" `note()` listing installed skill names from the parsed skillset's `skillsDir`, and calls `markInstall()` to write the `.nori-managed` marker. Manifest writing and skill listing are non-fatal. The install output order is: Slash Commands note -> Subagents note -> Settings note -> Skills note.

Profile discovery (`listProfiles()`) is not part of the agent -- it lives in @/src/cli/features/managedFolder.ts as an agent-agnostic utility. CLI commands import it directly.

The AgentRegistry (@/src/cli/features/agentRegistry.ts) registers this agent and provides lookup by name. CLI commands use `AgentRegistry.getInstance().get({ name: "claude-code" })` to obtain the agent implementation.

The `LoaderRegistry` class (@/src/cli/features/claude-code/loaderRegistry.ts) implements the shared `LoaderRegistry` interface. Loaders execute in order: config, skillsets, hooks, statusline, announcements.

Each loader implements the `Loader` interface with a `run()` method. The shared `configLoader` (@/src/cli/features/config/loader.ts) serves as the single point of config persistence during installation.

**Global settings** (hooks, statusline, announcements) install to `~/.claude/` and are shared across all Nori installations. Skillset-dependent features (claudemd, skills, slashcommands, subagents) are handled by sub-loaders within the skillsets feature at @/src/cli/features/claude-code/skillsets/.

### Core Implementation

The agent detects installation by checking for a `.nori-managed` marker file in `.claude/`, falling back to checking `CLAUDE.md` for a `NORI-AI MANAGED BLOCK` string for backwards compatibility. `paths.ts` centralizes Claude-Code-specific path computations (e.g., `getClaudeDir`, `getClaudeSettingsFile`, `getClaudeHomeDir`), distinguishing between the install directory (`{installDir}/.claude/`) and the home directory (`~/.claude/`) -- hooks and statusline write to `~/.claude/settings.json` so they work from any subdirectory, while skillset-specific config writes to the install directory. Agent-agnostic paths (`getNoriDir`, `getNoriSkillsetsDir`) now live in @/src/cli/features/paths.ts, and template substitution (`substituteTemplatePaths`) now lives in @/src/cli/features/template.ts. `existingConfigCapture.ts` detects pre-existing unmanaged Claude Code config and can capture it as a named skillset. `factoryReset.ts` walks the ancestor directory tree to find and remove all `.claude/` directories and `CLAUDE.md` files.

### Things to Know

The `LoaderRegistry` enforces installation order: config must run before profiles because profiles depend on config state. The `switchSkillset` method on the agent validates that the target skillset exists (has `nori.json`) before updating `~/.nori-config.json`. The `installDir` parameter in `switchSkillset` is a per-invocation override (e.g., `--install-dir` CLI flag) and is intentionally not written to the config file; only `sks config installDir <path>` changes the persisted `installDir`. The `markInstall` method writes the active skillset name into the `.nori-managed` marker file.

- **`switchSkillset` must explicitly pass through all config fields to `saveConfig()`**: The `saveConfig()` function in @/src/cli/config.ts only persists fields that are explicitly provided. `switchSkillset` reads the current config and passes every field back to `saveConfig()` along with the new `activeSkillset`. If a field is omitted, it is silently dropped from the config file. This includes auth fields, `defaultAgents`, `garbageCollectTranscripts`, `transcriptDestination`, `autoupdate`, `version`, and `installDir`.

Created and maintained by Nori.
