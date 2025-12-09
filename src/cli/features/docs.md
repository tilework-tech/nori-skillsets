# Noridoc: features

Path: @/src/cli/features

### Overview

Feature loader registry and individual feature implementations for installing Nori components into Claude Code. Uses a directory-based profile system where each profile contains complete configurations for CLAUDE.md, skills, subagents, and slash commands. Contains loaders for: version, config, profiles, hooks, statusline, global slashcommands, and announcements.

### How it fits into the larger codebase

This folder contains the modular installer architecture where each feature is a loader that installs a specific component. The LoaderRegistry (@/src/cli/features/loaderRegistry.ts) manages all feature loaders and executes them sequentially during installation by @/src/cli/commands/install/install.ts. Loaders execute in order: version, config, profiles, hooks, statusline, slashcommands, announcements. During uninstall, the order is reversed.

Each loader implements the Loader interface with run(), uninstall(), and validate() methods. The configLoader (@/src/cli/features/config/loader.ts) is the single point of config persistence during installation - it saves the Config to `.nori-config.json` including auth credentials, profile selection, and user preferences.

**Global settings** (hooks, statusline, slashcommands) install to `~/.claude/` and are shared across all Nori installations. During uninstall, these can be preserved or removed as a group via the `removeGlobalSettings` flag. Profile-dependent features (claudemd, skills, profile-specific slashcommands, subagents) are handled by sub-loaders within the profiles feature at @/src/cli/features/profiles/.

The global slashcommands loader (@/src/cli/features/slashcommands/loader.ts) installs profile-agnostic commands (nori-debug, nori-switch-profile, nori-info, etc.) directly to `~/.claude/commands/`. Profile-specific slash commands (nori-init-docs, nori-sync-docs) remain in profile mixins and are handled by @/src/cli/features/profiles/slashcommands/loader.ts.

### Core Implementation

Each loader implements run(config) to install, uninstall(config) to remove, and validate(config) to check installation state. The profiles loader (@/src/cli/features/profiles/loader.ts) orchestrates profile-dependent features through a ProfileLoaderRegistry that manages sub-loaders for claudemd, skills, slashcommands, and subagents within each profile. Profile switching is handled by the /nori-switch-profile slash command (or npx nori-ai switch-profile CLI command) which updates nori-config.json and re-runs installation to apply the new profile.

The LoaderRegistry provides two methods for retrieving loaders: getAll() returns loaders in registration order, and getAllReversed() returns loaders in reverse order. The install process uses getAll() because profiles must run first to create profile directories that other loaders read from. The uninstall process uses getAllReversed() so profile-dependent loaders can still read from profile directories before the profiles loader deletes them.

### Things to Know

Profile structure is now directory-based rather than JSON-based. Each profile directory (senior-swe, amol, nontechnical) contains CLAUDE.md, skills/, subagents/, slashcommands/, and optionally PROFILE.md. The major change in #197 removed preference-based CLAUDE.md customization (base-instructions.md with CUSTOMIZABLE markers) in favor of complete per-profile CLAUDE.md files. Skills list generation happens at install time, not at profile creation time. Paid skills use a 'paid-' prefix in the profile's skills/ directory but are installed without the prefix (e.g., paid-recall/ becomes the skills directory's recall/). The switch-nori-profile command updates nori-config.json and re-runs installation to apply the new profile. The managed block pattern allows users to add custom instructions outside the block without losing them during reinstalls. Default profile is 'senior-swe'. Running install multiple times is idempotent and regenerates all installed files from the selected profile. Most changes require Claude Code restart except CLAUDE.md which applies to new conversations immediately. Source markdown files use template placeholders (`{{skills_dir}}`, `{{profiles_dir}}`, etc.) that are substituted during installation to support configurable installation directories - home installs get tilde notation paths while custom installs get absolute paths.
