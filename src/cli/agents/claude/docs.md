# Noridoc: claude

Path: @/plugin/src/cli/agents/claude

### Overview

Claude Code agent implementation containing the LoaderRegistry and feature loaders for installing Nori components into Claude Code. Uses a directory-based profile system where each profile contains complete configurations for CLAUDE.md, skills, subagents, and slash commands. Contains loaders for: config, version, profiles, hooks, statusline, and announcements.

### How it fits into the larger codebase

This folder is the Claude Code implementation within the multi-agent architecture. The AgentRegistry (@/plugin/src/cli/agents/agentRegistry.ts) maps "claude-code" to this directory's LoaderRegistry. The LoaderRegistry (`loaderRegistry.ts`) manages feature loaders that execute sequentially during installation by @/plugin/src/cli/commands/install/install.ts.

```
AgentRegistry
     |
     +-- getAgent({ name: "claude-code" })
              |
              +-- getLoaderRegistry() --> LoaderRegistry (this folder)
              +-- getSourceProfilesDir() --> profiles/config/ (this folder)
```

The configLoader (`config/loader.ts`) is the single point of config persistence during installation - it saves the Config to `.nori-config.json` including auth credentials, profile selection, and user preferences. Each loader implements the Loader interface with run(), uninstall(), and validate() methods. The unified Config type from @/plugin/src/cli/config.ts contains auth credentials (optional), profile.baseProfile (string name like 'senior-swe', 'amol'), user preferences, and installDir. Paid vs free installation is determined by calling `isPaidInstall({ config })` which checks if `config.auth != null`. All feature loaders load their content from the selected profile directory at `profiles/config/{profileName}/`. The profiles loader copies all profile directories to `~/.claude/profiles/` for profile switching via the /nori-switch-profile slash command.

### Core Implementation

Each loader implements run(config) to install, uninstall(config) to remove, and validate(config) to check installation state. Loaders use getConfigDir({ profileName }) helpers to construct paths to profile-specific config directories. The profilesLoader composes profiles from mixins (stored in `profiles/config/_mixins/`) and copies them to `~/.claude/profiles/`. This includes CLAUDE.md generation with dynamically-generated skills lists by globbing for SKILL.md files and extracting frontmatter. Skills, slashcommands, and subagents are composed from mixin directories and the profile's own subdirectories. The statusline loader installs a bash script to display profile name in the terminal prompt. The hooks loader installs event hooks (autoupdate, summarize) that run on Claude Code events. All loaders use fs/promises for async file operations and utilities from @/plugin/src/cli for logging. Installation is sequential to avoid race conditions.

The LoaderRegistry provides two methods for retrieving loaders: getAll() returns loaders in registration order (version, config, profiles first), and getAllReversed() returns loaders in reverse order. The install process uses getAll() because version/config must run before profiles. The uninstall process uses getAllReversed() so dependent loaders can still access profile directories before they're removed.

**Loader Registration Order:**
1. versionLoader - tracks installed version for upgrade detection
2. configLoader - persists configuration to disk
3. profilesLoader - composes and installs profile directories
4. hooksLoader - installs Claude Code event hooks
5. statuslineLoader - installs terminal status line script
6. announcementsLoader - handles version announcements

### Things to Know

Profile structure is directory-based. Each profile directory (senior-swe, amol, etc.) references mixins and may contain its own CLAUDE.md additions, skills/, subagents/, slashcommands/ overrides. Skills list generation happens at install time via the profiles loader. Paid skills use a 'paid-' prefix in the mixin's skills/ directory but are installed without the prefix. The managed block pattern allows users to add custom instructions outside the block without losing them during reinstalls. Default profile is 'senior-swe'. Running install multiple times is idempotent. Most changes require Claude Code restart except CLAUDE.md which applies to new conversations immediately. Source markdown files use template placeholders (`{{skills_dir}}`, `{{profiles_dir}}`, etc.) that are substituted during installation.

Created and maintained by Nori.
