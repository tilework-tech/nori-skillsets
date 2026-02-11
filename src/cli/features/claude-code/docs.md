# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

Claude Code agent implementation that satisfies the Agent interface from @/src/cli/features/agentRegistry.ts. Contains feature loaders and configurations for installing Nori components into Anthropic's Claude Code CLI tool. Uses a directory-based profile system where each profile is self-contained with CLAUDE.md, skills, subagents, and slash commands. Contains loaders for: config, profiles, hooks, statusline, global slashcommands (no-op), and announcements. Claude-specific path helpers are encapsulated in paths.ts within this directory.

### How it fits into the larger codebase

This `claude-code/` subdirectory implements the Agent interface defined in @/src/cli/features/agentRegistry.ts. The `claudeCodeAgent` object in agent.ts provides:
- `name`: "claude-code"
- `displayName`: "Claude Code"
- `getLoaderRegistry()`: Returns the LoaderRegistry singleton with all Claude Code loaders
- `switchProfile({ installDir, profileName })`: Validates profile exists (handles both flat and namespaced paths via `path.join`), updates config with new profile, logs success message. Imports `MANIFEST_FILE` from @/src/cli/features/managedFolder.ts to identify valid profiles.
- `factoryReset({ path })`: Delegates to `factoryResetClaudeCode` from @/src/cli/features/claude-code/factoryReset.ts. Discovers and removes all `.claude` directories and `CLAUDE.md` files by walking up the ancestor directory tree from the given path.

Profile discovery (`listProfiles()`) is not part of the agent -- it lives in @/src/cli/features/managedFolder.ts as an agent-agnostic utility. CLI commands import it directly.

The AgentRegistry (@/src/cli/features/agentRegistry.ts) registers this agent and provides lookup by name. CLI commands use `AgentRegistry.getInstance().get({ name: "claude-code" })` to obtain the agent implementation.

The `LoaderRegistry` class (@/src/cli/features/claude-code/loaderRegistry.ts) implements the shared `LoaderRegistry` interface. Loaders execute in order: config, profiles, hooks, statusline, slashcommands, announcements.

Each loader implements the `Loader` interface with a `run()` method. The shared `configLoader` (@/src/cli/features/config/loader.ts) serves as the single point of config persistence during installation.

**Global settings** (hooks, statusline, slashcommands, announcements) install to `~/.claude/` and are shared across all Nori installations. Profile-dependent features (claudemd, skills, profile-specific slashcommands, subagents) are handled by sub-loaders within the profiles feature at @/src/cli/features/claude-code/profiles/.

### Core Implementation

Each loader implements run(config) to install. The profiles loader (@/src/cli/features/claude-code/profiles/loader.ts) orchestrates profile-dependent features through a ProfileLoaderRegistry that manages sub-loaders for claudemd, skills, slashcommands, and subagents within each profile.

**Factory Reset** (factoryReset.ts): Provides two exports:
- `findClaudeCodeArtifacts({ startDir, stopDir })`: Walks up the ancestor tree from `startDir`, checking each directory for a `.claude` directory and a `CLAUDE.md` file. Returns an ordered array of `ClaudeCodeArtifact` objects (each with `path` and `type`). The `stopDir` parameter (inclusive) bounds the traversal for test isolation; when omitted, traversal continues to the filesystem root.
- `factoryResetClaudeCode({ path })`: Lists discovered artifacts, warns the user, prompts for the literal string "confirm", then deletes directories with `fs.rm({ recursive: true })` and files with `fs.unlink`. Returns early with an info message if no artifacts are found.

**Self-contained profiles**: Each profile is a complete, standalone directory containing all content directly (CLAUDE.md, skills/, subagents/, slashcommands/). No mixin composition or inheritance is used. The package does not ship any built-in profiles -- profiles are obtained from the registry or created by users.

**Config Loader Token-Based Auth:** The configLoader handles credential persistence with automatic token conversion. During installation, if the config contains a password but no refreshToken, the loader authenticates via Firebase SDK to obtain a refresh token. The refresh token is then saved to `.nori-config.json` instead of the password.

The LoaderRegistry provides getAll() for install order. The profiles loader must run first because other loaders read from the profile directories it creates.

**Hooks loader** (@/src/cli/features/claude-code/hooks/loader.ts): Configures hooks: contextUsageWarningHook, updateCheckHook, notifyHook, and commitAuthorHook. Also sets `includeCoAuthoredBy = false` in settings.json. The updateCheckHook is a SessionStart hook that reads the version cache (populated by @/src/cli/updates/) and outputs a systemMessage if an update is available.

**Slashcommands loader** (@/src/cli/features/claude-code/slashcommands/loader.ts): Now a no-op. Global slash commands have been removed to reduce complexity.

### Things to Know

**Path Helpers (paths.ts):** All Claude-specific path functions live in @/src/cli/features/claude-code/paths.ts. There are three categories:

**Claude project-relative paths** (take `installDir` param):

| Function | Returns |
|----------|---------|
| `getClaudeDir({ installDir })` | `{installDir}/.claude` |
| `getClaudeSettingsFile({ installDir })` | `{installDir}/.claude/settings.json` |
| `getClaudeAgentsDir({ installDir })` | `{installDir}/.claude/agents` |
| `getClaudeCommandsDir({ installDir })` | `{installDir}/.claude/commands` |
| `getClaudeMdFile({ installDir })` | `{installDir}/.claude/CLAUDE.md` |
| `getClaudeSkillsDir({ installDir })` | `{installDir}/.claude/skills` |

**Nori centralized paths** (zero-arg, always resolve to home directory):

| Function | Returns |
|----------|---------|
| `getNoriDir()` | `~/.nori` |
| `getNoriProfilesDir()` | `~/.nori/profiles` |

**Claude home-based paths** (no params):

| Function | Returns |
|----------|---------|
| `getClaudeHomeDir()` | `~/.claude` |
| `getClaudeHomeSettingsFile()` | `~/.claude/settings.json` |
| `getClaudeHomeCommandsDir()` | `~/.claude/commands` |

Global features (hooks, statusline) use home-based paths because Claude Code reads these from the user's home directory. Nori centralized paths use `os.homedir()` to ensure config and profiles are always in the same location regardless of working directory.

**Directory Separation Architecture:** Profiles are stored in `~/.nori/profiles/` instead of `~/.claude/profiles/`. This creates a clear separation between Nori's internal profile repository and Claude Code's native artifacts.

**Profile Directory Structure:** Profiles support two directory layouts:
- Flat profiles: `~/.nori/profiles/{profile-name}/` - for public registry packages
- Namespaced profiles: `~/.nori/profiles/{org}/{profile-name}/` - for organization-specific registry packages

The `listProfiles()` function in @/src/cli/features/managedFolder.ts discovers both layouts by first checking if a directory contains `nori.json` (flat profile), and if not, checking for subdirectories that contain `nori.json` (org directory with nested profiles). Namespaced profiles are returned in `org/profile-name` format.

**Profile structure**: Each profile directory contains CLAUDE.md, skills/, subagents/, slashcommands/, and nori.json (unified manifest). All content is self-contained - no mixin composition or inheritance.

**Template placeholders**: Source markdown files use placeholders (`{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, `{{install_dir}}`) that are substituted during installation via @/src/cli/features/claude-code/template.ts.

**Switch profile**: The switch-nori-profile command updates nori-config.json and re-runs installation to apply the new profile. Most changes require Claude Code restart except CLAUDE.md which applies to new conversations immediately.

**Managed block pattern**: CLAUDE.md uses a managed block pattern allowing users to add custom instructions outside the block without losing them during reinstalls.

Created and maintained by Nori.
