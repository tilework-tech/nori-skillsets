# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

Claude Code agent implementation that satisfies the Agent interface from @/src/cli/features/agentRegistry.ts. Contains feature loaders and configurations for installing Nori components into Anthropic's Claude Code CLI tool. Uses a directory-based profile system where each profile is self-contained with CLAUDE.md, skills, subagents, and slash commands. Contains loaders for: config, profiles, hooks, statusline, global slashcommands, and announcements. Claude-specific path helpers are encapsulated in paths.ts within this directory.

### How it fits into the larger codebase

This `claude-code/` subdirectory implements the Agent interface defined in @/src/cli/features/agentRegistry.ts. The `claudeCodeAgent` object in agent.ts provides:
- `name`: "claude-code"
- `displayName`: "Claude Code"
- `getLoaderRegistry()`: Returns the LoaderRegistry singleton with all Claude Code loaders
- `listProfiles({ installDir })`: Scans installed `.nori/profiles/` for directories containing `CLAUDE.md`
- `listSourceProfiles()`: Scans package's `profiles/config/` for directories with `profile.json`, returns `SourceProfile[]` with name and description
- `switchProfile({ installDir, profileName })`: Validates profile exists, filters out config entries for uninstalled agents, updates config with new profile, logs success message
- `getGlobalLoaders()`: Returns loaders that write to `~/.claude/` global config (hooks, statusline, slashcommands, announcements)

The AgentRegistry (@/src/cli/features/agentRegistry.ts) registers this agent and provides lookup by name. CLI commands use `AgentRegistry.getInstance().get({ name: "claude-code" })` to obtain the agent implementation.

The `LoaderRegistry` class (@/src/cli/features/claude-code/loaderRegistry.ts) implements the shared `LoaderRegistry` interface. Loaders execute in order: config, profiles, hooks, statusline, slashcommands, announcements. During uninstall, the order is reversed.

Each loader implements the `Loader` interface with `run()`, `uninstall()`, and optional `validate()` methods. The shared `configLoader` (@/src/cli/features/config/loader.ts) serves as the single point of config persistence during installation.

**Global settings** (hooks, statusline, slashcommands, announcements) install to `~/.claude/` and are shared across all Nori installations. Profile-dependent features (claudemd, skills, profile-specific slashcommands, subagents) are handled by sub-loaders within the profiles feature at @/src/cli/features/claude-code/profiles/.

### Core Implementation

Each loader implements run(config) to install, uninstall(config) to remove, and validate(config) to check installation state. The profiles loader (@/src/cli/features/claude-code/profiles/loader.ts) orchestrates profile-dependent features through a ProfileLoaderRegistry that manages sub-loaders for claudemd, skills, slashcommands, and subagents within each profile.

**Self-contained profiles**: Each profile in @/src/cli/features/claude-code/profiles/config/ is a complete, standalone directory containing all content directly (CLAUDE.md, skills/, subagents/, slashcommands/). No mixin composition or inheritance is used - profiles are copied as-is to `~/.nori/profiles/`.

**Paid Skills/Subagents**: Skills and subagents with a `paid-` prefix are tier-gated. For paid users, the prefix is stripped when copying. For free users, `paid-` prefixed items are skipped.

**Config Loader Token-Based Auth:** The configLoader handles credential persistence with automatic token conversion. During installation, if the config contains a password but no refreshToken, the loader authenticates via Firebase SDK to obtain a refresh token. The refresh token is then saved to `.nori-config.json` instead of the password.

The LoaderRegistry provides getAll() for install order and getAllReversed() for uninstall order. The profiles loader must run first because other loaders read from the profile directories it creates.

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

**Nori project-relative paths** (take `installDir` param):

| Function | Returns |
|----------|---------|
| `getNoriDir({ installDir })` | `{installDir}/.nori` |
| `getNoriProfilesDir({ installDir })` | `{installDir}/.nori/profiles` |
| `getNoriConfigFile({ installDir })` | `{installDir}/.nori/config.json` |
| `getNoriSkillsDir({ installDir })` | `{installDir}/.nori/skills` |
| `getNoriSkillDir({ installDir, skillName })` | `{installDir}/.nori/skills/{skillName}` |

**Claude home-based paths** (no params):

| Function | Returns |
|----------|---------|
| `getClaudeHomeDir()` | `~/.claude` |
| `getClaudeHomeSettingsFile()` | `~/.claude/settings.json` |
| `getClaudeHomeCommandsDir()` | `~/.claude/commands` |

Global features (hooks, statusline, global slash commands) use home-based paths because Claude Code reads these from the user's home directory.

**Directory Separation Architecture:** Profiles are stored in `~/.nori/profiles/` instead of `~/.claude/profiles/`. This creates a clear separation between Nori's internal profile repository and Claude Code's native artifacts.

**Profile structure**: Each profile directory contains CLAUDE.md, skills/, subagents/, slashcommands/, and profile.json. All content is self-contained - no mixin composition or inheritance.

**Template placeholders**: Source markdown files use placeholders (`{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, `{{install_dir}}`) that are substituted during installation via @/src/cli/features/claude-code/template.ts.

**Switch profile**: The switch-nori-profile command updates nori-config.json and re-runs installation to apply the new profile. Most changes require Claude Code restart except CLAUDE.md which applies to new conversations immediately.

**Managed block pattern**: CLAUDE.md uses a managed block pattern allowing users to add custom instructions outside the block without losing them during reinstalls.

**Default profile**: Falls back to 'senior-swe' if no profile is configured.

Created and maintained by Nori.
