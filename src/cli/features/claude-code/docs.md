# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

The Claude Code agent configuration. This directory contains the `AgentConfig` data struct for Claude Code (`claudeCodeConfig`), along with Claude-Code-specific path utilities, factory reset logic, and feature loaders (hooks, statusline, announcements). All behavioral operations (install, remove, detect, capture) are handled by shared handler functions at `@/src/cli/features/shared/agentHandlers.ts` that accept `AgentConfig` as a parameter. Agent-agnostic utilities (Nori directory paths, template substitution, skillset metadata) live in @/src/cli/features/.

### How it fits into the larger codebase

`agent.ts` exports `claudeCodeConfig`, which is registered in `@/src/cli/features/agentRegistry.ts`. CLI commands look up this config via `AgentRegistry.getInstance().get({ name: "claude-code" })` and pass it to shared handler functions from `@/src/cli/features/shared/agentHandlers.ts` for operations like installation, removal, and detection.

The `claudeCodeConfig` object in agent.ts provides these data fields:
- `name`: "claude-code"
- `displayName`: "Claude Code"
- `description`: "Instructions, skills, subagents, commands, hooks, statusline, watch"
- `agentDirName`: ".claude" -- relative path from installDir to the agent's config directory
- `instructionFilePath`: "CLAUDE.md" -- relative path from agent dir to the instruction file
- `configFileName`: "CLAUDE.md" -- used when parsing skillsets from ~/.nori/profiles/
- `skillsPath`: "skills", `slashcommandsPath`: "commands", `subagentsPath`: "agents"
- `extraLoaders`: [hooksLoader, statuslineLoader, announcementsLoader] -- agent-specific loaders run after shared profile loaders
- `extraManagedFiles`: ["settings.json", "nori-statusline.sh"] -- additional root-level files beyond CLAUDE.md
- `transcriptDirectory`: `~/.claude/projects` -- where Claude Code stores session transcript files (JSONL). Used by the watch command.
- `hasLegacyManifest`: true -- enables legacy manifest cleanup at `~/.nori/installed-manifest.json`
- `configurePermissions`: Adds skills dir and profiles dir to settings.json `additionalDirectories`
- `findArtifacts`: Delegates to `findClaudeCodeArtifacts` from factoryReset.ts
- `factoryReset`: Delegates to `factoryResetClaudeCode` from factoryReset.ts
- `legacyMarkerDetection`: Checks CLAUDE.md for "NORI-AI MANAGED BLOCK" string for backwards-compatible install detection

Shared handler functions compute paths from `AgentConfig` fields (e.g., `getAgentDir({ agentConfig, installDir })` returns `path.join(installDir, agentConfig.agentDirName)`), so path utilities like `getAgentDir` are no longer agent-specific methods.

Profile discovery (`listProfiles()`) is not part of the agent config -- it lives in @/src/cli/features/managedFolder.ts as an agent-agnostic utility. CLI commands import it directly.

The AgentRegistry (@/src/cli/features/agentRegistry.ts) registers this config and provides lookup by name. CLI commands use `AgentRegistry.getInstance().get({ name: "claude-code" })` to obtain the `AgentConfig`.

Agent-specific extra loaders (hooks, statusline, announcements) are listed in the `extraLoaders` field and are run by the shared `installSkillset` handler after the shared profile loaders.

**Global settings** (hooks, statusline, announcements) install to `~/.claude/` and are shared across all Nori installations. Skillset-dependent features (instruction file, skills, slashcommands, subagents) are handled by shared profile loaders at @/src/cli/features/shared/profileLoaders/.

### Core Implementation

`paths.ts` centralizes Claude-Code-specific path computations (e.g., `getClaudeDir`, `getClaudeSettingsFile`, `getClaudeHomeDir`), distinguishing between the install directory (`{installDir}/.claude/`) and the home directory (`~/.claude/`) -- hooks and statusline write to `~/.claude/settings.json` so they work from any subdirectory, while skillset-specific config writes to the install directory. Agent-agnostic paths (`getNoriDir`, `getNoriSkillsetsDir`) now live in @/src/cli/features/paths.ts, and template substitution (`substituteTemplatePaths`) now lives in @/src/cli/features/template.ts. `factoryReset.ts` walks the ancestor directory tree to find and remove all `.claude/` directories and `CLAUDE.md` files.

Installation detection is handled by the shared `isInstalledAtDir` handler, which checks for `.nori-managed` marker file and falls back to `claudeCodeConfig.legacyMarkerDetection` (checks CLAUDE.md for managed block string). Config capture and existing config detection are handled by the shared `captureExistingConfig` and `detectExistingConfig` handlers respectively.

### Things to Know

The shared `installSkillset` handler enforces installation order: config loader runs first, then shared profile loaders, then agent-specific extra loaders. The shared `switchSkillset` handler validates that the target skillset exists (has `nori.json`) and logs -- it does not persist config. Config persistence (`updateConfig({ activeSkillset })`) is handled by the command layer (e.g., `switchSkillsetAction`, `registryInstallMain`), gated on install-dir provenance so that transient `--install-dir` CLI overrides do not write state to `.nori-config.json`. Only `sks config installDir <path>` changes the persisted `installDir`. The shared `markInstall` handler writes the active skillset name into the `.nori-managed` marker file.


Created and maintained by Nori.
