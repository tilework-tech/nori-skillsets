# Noridoc: claude-code

Path: @/src/cli/features/claude-code

### Overview

Claude Code agent implementation that satisfies the Agent interface from @/src/cli/features/agentRegistry.ts. Contains feature loaders and configurations for installing Nori components into Anthropic's Claude Code CLI tool. Uses a directory-based profile system where each profile contains complete configurations for CLAUDE.md, skills, subagents, and slash commands. Contains loaders for: version, config, profiles, hooks, statusline, global slashcommands, and announcements. Claude-specific path helpers are encapsulated in paths.ts within this directory.

### How it fits into the larger codebase

This `claude-code/` subdirectory implements the Agent interface defined in @/src/cli/features/agentRegistry.ts. The `claudeCodeAgent` object in agent.ts provides:
- `name`: "claude-code"
- `displayName`: "Claude Code"
- `getLoaderRegistry()`: Returns the LoaderRegistry singleton with all Claude Code loaders
- `listProfiles({ installDir })`: Scans installed `.claude/profiles/` for directories containing `CLAUDE.md`
- `listSourceProfiles()`: Scans package's `profiles/config/` for directories with `profile.json`, returns `SourceProfile[]` with name and description
- `switchProfile({ installDir, profileName })`: Validates profile exists, updates config, logs success message

The AgentRegistry (@/src/cli/features/agentRegistry.ts) registers this agent and provides lookup by name. CLI commands use `AgentRegistry.getInstance().get({ name: "claude-code" })` to obtain the agent implementation and access its loaders.

This architecture enables future support for additional AI agents (e.g., Cursor IDE) by creating new agent implementations in sibling directories that satisfy the same Agent interface.

The `LoaderRegistry` class (@/src/cli/features/claude-code/loaderRegistry.ts) implements the shared `LoaderRegistry` interface from @/src/cli/features/agentRegistry.ts. It manages all Claude Code feature loaders and executes them sequentially during installation. Loaders execute in order: version, config, profiles, hooks, statusline, slashcommands, announcements. During uninstall, the order is reversed.

Each loader implements the `Loader` interface (from @/src/cli/features/agentRegistry.ts) with `run()`, `uninstall()`, and optional `validate()` methods. The shared `configLoader` (@/src/cli/features/config/loader.ts) is included in the registry and serves as the single point of config persistence during installation - it saves the Config to `.nori-config.json` including auth credentials, profile selection, and user preferences.

**Global settings** (hooks, statusline, slashcommands) install to `~/.claude/` and are shared across all Nori installations. During uninstall, these can be preserved or removed as a group via the `removeGlobalSettings` flag. Profile-dependent features (claudemd, skills, profile-specific slashcommands, subagents) are handled by sub-loaders within the profiles feature at @/src/cli/features/claude-code/profiles/.

The global slashcommands loader (@/src/cli/features/claude-code/slashcommands/loader.ts) installs profile-agnostic commands (nori-debug, nori-switch-profile, nori-info, etc.) directly to `~/.claude/commands/`. Profile-specific slash commands (nori-init-docs, nori-sync-docs) remain in profile mixins and are handled by @/src/cli/features/claude-code/profiles/slashcommands/loader.ts.

### Core Implementation

Each loader implements run(config) to install, uninstall(config) to remove, and validate(config) to check installation state. The profiles loader (@/src/cli/features/claude-code/profiles/loader.ts) orchestrates profile-dependent features through a ProfileLoaderRegistry that manages sub-loaders for claudemd, skills, slashcommands, and subagents within each profile. Profile switching is handled by the /nori-switch-profile slash command (or npx nori-ai switch-profile CLI command) which updates nori-config.json and re-runs installation to apply the new profile.

The LoaderRegistry provides two methods for retrieving loaders: getAll() returns loaders in registration order, and getAllReversed() returns loaders in reverse order. The install process uses getAll() because profiles must run first to create profile directories that other loaders read from. The uninstall process uses getAllReversed() so profile-dependent loaders can still read from profile directories before the profiles loader deletes them.

### Things to Know

**Path Helpers (paths.ts):** All Claude-specific path functions live in @/src/cli/features/claude-code/paths.ts to keep the agent self-contained. These functions take an `installDir` parameter and return paths for Claude Code's directory structure:

| Function | Returns |
|----------|---------|
| `getClaudeDir({ installDir })` | `{installDir}/.claude` |
| `getClaudeSettingsFile({ installDir })` | `{installDir}/.claude/settings.json` |
| `getClaudeAgentsDir({ installDir })` | `{installDir}/.claude/agents` |
| `getClaudeCommandsDir({ installDir })` | `{installDir}/.claude/commands` |
| `getClaudeMdFile({ installDir })` | `{installDir}/.claude/CLAUDE.md` |
| `getClaudeSkillsDir({ installDir })` | `{installDir}/.claude/skills` |
| `getClaudeProfilesDir({ installDir })` | `{installDir}/.claude/profiles` |
| `getClaudeHomeDir()` | `~/.claude` (no installDir, always user home) |
| `getClaudeHomeSettingsFile()` | `~/.claude/settings.json` |

The `getClaudeHomeDir()` and `getClaudeHomeSettingsFile()` functions return fixed paths (always `~/.claude`) because Claude Code always reads hooks and statusline configuration from the user's home directory regardless of where Nori is installed. All loaders within the claude-code directory import directly from `@/cli/features/claude-code/paths.js`. For backward compatibility, @/src/cli/env.ts re-exports these functions.

Profile structure is now directory-based rather than JSON-based. Each profile directory (senior-swe, amol, nontechnical) contains CLAUDE.md, skills/, subagents/, slashcommands/, and optionally PROFILE.md. The major change in #197 removed preference-based CLAUDE.md customization (base-instructions.md with CUSTOMIZABLE markers) in favor of complete per-profile CLAUDE.md files. Skills list generation happens at install time, not at profile creation time. Paid skills use a 'paid-' prefix in the profile's skills/ directory but are installed without the prefix (e.g., paid-recall/ becomes the skills directory's recall/). The switch-nori-profile command updates nori-config.json and re-runs installation to apply the new profile. The managed block pattern allows users to add custom instructions outside the block without losing them during reinstalls. Default profile is 'senior-swe'. Running install multiple times is idempotent and regenerates all installed files from the selected profile. Most changes require Claude Code restart except CLAUDE.md which applies to new conversations immediately. Source markdown files use template placeholders (`{{skills_dir}}`, `{{profiles_dir}}`, `{{commands_dir}}`, `{{install_dir}}`) that are substituted during installation via @/src/cli/features/claude-code/template.ts. The substituteTemplatePaths function replaces these placeholders with absolute paths based on the installation directory.
